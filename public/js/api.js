// Crab Box Register - Client API Layer with Offline Resilience & Auto-Sync
(function (window) {
  'use strict';

  var API_BASE = '/api';
  var TOKEN_KEY = 'crabreg_jwt_token';
  var USER_KEY = 'crabreg_user_profile';

  var Api = {
    mode: 'connecting', // 'synced', 'offline', 'connecting'
    listeners: [],

    onStatusChange: function (fn) {
      this.listeners.push(fn);
    },

    notifyStatus: function (status, info) {
      this.mode = status;
      this.listeners.forEach(function (fn) { fn(status, info); });
    },

    getToken: function () {
      return localStorage.getItem(TOKEN_KEY) || '';
    },

    setAuth: function (token, user) {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
      else localStorage.removeItem(USER_KEY);
    },

    getUser: function () {
      try {
        var u = localStorage.getItem(USER_KEY);
        return u ? JSON.parse(u) : { id: 1, name: 'Farm Owner', email: 'admin@crabfarm.in', role: 'owner' };
      } catch (e) {
        return { id: 1, name: 'Farm Owner', email: 'admin@crabfarm.in', role: 'owner' };
      }
    },

    request: async function (path, options) {
      options = options || {};
      options.headers = options.headers || {};
      
      var token = this.getToken();
      if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
      }
      if (!(options.body instanceof FormData)) {
        options.headers['Content-Type'] = 'application/json';
      }

      try {
        var resp = await fetch(API_BASE + path, options);
        if (!resp.ok) {
          var errJson;
          try { errJson = await resp.json(); } catch (e) { errJson = { error: resp.statusText }; }
          throw new Error(errJson.error || ('Request failed: ' + resp.status));
        }
        var data = await resp.json();
        this.notifyStatus('synced');
        return data;
      } catch (err) {
        // If network / fetch error, switch to offline mode
        if (err.name === 'TypeError' || err.message.indexOf('fetch') !== -1) {
          this.notifyStatus('offline', err.message);
        }
        throw err;
      }
    },

    checkConnection: async function () {
      try {
        var resp = await fetch(API_BASE + '/sync/status', { method: 'GET' });
        if (resp.ok) {
          var data = await resp.json();
          this.notifyStatus('synced', data.engine);
          return true;
        }
      } catch (e) {}
      this.notifyStatus('offline');
      return false;
    },

    // Auth
    isLoggedIn: function () {
      return !!(this.getToken() && localStorage.getItem(USER_KEY));
    },

    logout: function () {
      this.setAuth(null, null);
    },

    sendOtp: function (phone) {
      return this.request('/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: phone })
      });
    },

    verifyOtp: function (phone, otp, name, role) {
      return this.request('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: phone, otp: otp, name: name, role: role })
      });
    },

    registerWithEmail: function (name, email, password, role) {
      return this.request('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name: name, email: email, password: password, role: role })
      });
    },

    login: function (identifier, password) {
      return this.request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: identifier, password: password })
      });
    },

    // Settings & Species
    getSettings: function () {
      return this.request('/settings');
    },
    updateSettings: function (patch) {
      return this.request('/settings', { method: 'PUT', body: JSON.stringify(patch) });
    },
    getSpecies: function () {
      return this.request('/species');
    },
    addSpecies: function (name) {
      return this.request('/species', { method: 'POST', body: JSON.stringify({ name: name }) });
    },

    // Inventory
    getInventory: function (filter) {
      return this.request('/inventory' + (filter ? '?filter=' + filter : ''));
    },
    getDeliveries: function () {
      return this.request('/inventory/deliveries');
    },
    removeDelivery: function (id) {
      return this.request('/inventory/deliveries/' + id, { method: 'DELETE' });
    },
    getUsedBatches: function (excludeCrab, excludeBox) {
      var q = [];
      if (excludeCrab) q.push('excludeCrab=' + excludeCrab);
      if (excludeBox) q.push('excludeBox=' + excludeBox);
      return this.request('/inventory/used-batches' + (q.length ? '?' + q.join('&') : ''));
    },
    receiveCrabs: function (seller, receivedDate, species, crabs) {
      return this.request('/inventory/receive', {
        method: 'POST',
        body: JSON.stringify({ seller: seller, received_date: receivedDate, species: species, crabs: crabs })
      });
    },
    updateInventoryCrab: function (id, patch) {
      return this.request('/inventory/' + id, { method: 'PUT', body: JSON.stringify(patch) });
    },
    removeInventoryCrab: function (id) {
      return this.request('/inventory/' + id, { method: 'DELETE' });
    },
    moveToBoxes: function (stockDate, assignments) {
      return this.request('/inventory/move', {
        method: 'POST',
        body: JSON.stringify({ stock_date: stockDate, assignments: assignments })
      });
    },

    // Boxes
    getBoxes: function () {
      return this.request('/boxes');
    },
    getBox: function (num) {
      return this.request('/boxes/' + num);
    },
    saveBox: function (num, data) {
      return this.request('/boxes/' + num, { method: 'PUT', body: JSON.stringify(data) });
    },
    deleteBox: function (num) {
      return this.request('/boxes/' + num, { method: 'DELETE' });
    },
    moveBox: function (fromNum, toNum) {
      return this.request('/boxes/' + fromNum + '/move', {
        method: 'POST',
        body: JSON.stringify({ to_box: toNum })
      });
    },

    // Harvests
    getHarvests: function () {
      return this.request('/harvests');
    },
    createHarvest: function (data, boxes) {
      return this.request('/harvests', {
        method: 'POST',
        body: JSON.stringify({ ...data, boxes: boxes })
      });
    },
    updateHarvest: function (id, patch) {
      return this.request('/harvests/' + id, { method: 'PUT', body: JSON.stringify(patch) });
    },
    deleteHarvest: function (id) {
      return this.request('/harvests/' + id, { method: 'DELETE' });
    },
    uploadHarvestFile: function (harvestId, file) {
      var formData = new FormData();
      formData.append('file', file);
      return this.request('/harvests/' + harvestId + '/files', {
        method: 'POST',
        body: formData
      });
    },
    removeHarvestFile: function (harvestId, fileId) {
      return this.request('/harvests/' + harvestId + '/files/' + fileId, { method: 'DELETE' });
    },
    getProfit: function () {
      return this.request('/harvests/profit');
    },

    // Monitor
    getReadings: function (since) {
      return this.request('/monitor/readings' + (since ? '?since=' + encodeURIComponent(since) : ''));
    },
    addReading: function (reading) {
      return this.request('/monitor/readings', { method: 'POST', body: JSON.stringify(reading) });
    },
    importReadings: function (readings) {
      return this.request('/monitor/import', { method: 'POST', body: JSON.stringify({ readings: readings }) });
    }
  };

  window.CrabApi = Api;
})(window);
