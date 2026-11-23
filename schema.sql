-- Crab Box Register - MySQL 8 Schema
-- Run this once to create the database. Weights are in grams, money in rupees with two decimals.

CREATE DATABASE IF NOT EXISTS crab_register CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE crab_register;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('owner','staff') NOT NULL DEFAULT 'staff',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  id TINYINT PRIMARY KEY DEFAULT 1,
  farm_name VARCHAR(120) NOT NULL DEFAULT '',
  box_count SMALLINT NOT NULL DEFAULT 40,
  temp_min DECIMAL(4,1) NULL,
  temp_max DECIMAL(4,1) NULL,
  ph_min DECIMAL(3,1) NULL,
  ph_max DECIMAL(3,1) NULL
);

CREATE TABLE IF NOT EXISTS species (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE
);

-- one row per batch number currently held by a crab (in stock or in a box)
CREATE TABLE IF NOT EXISTS batch_numbers_in_use (
  batch_no VARCHAR(20) PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  seller VARCHAR(120) NOT NULL,
  received_date DATE NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_crabs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  delivery_id INT NOT NULL,
  batch_no VARCHAR(20) NOT NULL,
  species VARCHAR(120) NOT NULL,
  sex ENUM('M','F') NULL,
  weight_g INT NOT NULL,
  price DECIMAL(10,2) NULL,
  status ENUM('stock','moved') NOT NULL DEFAULT 'stock',
  moved_to_box SMALLINT NULL,
  moved_date DATE NULL,
  notes VARCHAR(500) NOT NULL DEFAULT '',
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
  INDEX (status),
  INDEX (batch_no)
);

-- an empty box has no row
CREATE TABLE IF NOT EXISTS boxes (
  box_no SMALLINT PRIMARY KEY,
  status ENUM('growing','molting','harvest','dead') NOT NULL DEFAULT 'growing',
  size ENUM('Large','Medium','Small','Soft shell','Other') NULL,
  species VARCHAR(120) NOT NULL,
  sex ENUM('M','F') NULL,
  batch_no VARCHAR(20) NULL,
  cost DECIMAL(10,2) NULL,
  source VARCHAR(160) NOT NULL DEFAULT '',
  stock_date DATE NOT NULL,
  initial_weight_g INT NOT NULL,
  end_date DATE NULL,
  notes VARCHAR(500) NOT NULL DEFAULT '',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE (batch_no)
);

CREATE TABLE IF NOT EXISTS box_weights (
  id INT AUTO_INCREMENT PRIMARY KEY,
  box_no SMALLINT NOT NULL,
  weighed_on DATE NOT NULL,
  weight_g INT NOT NULL,
  FOREIGN KEY (box_no) REFERENCES boxes(box_no) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS box_moults (
  id INT AUTO_INCREMENT PRIMARY KEY,
  box_no SMALLINT NOT NULL,
  moulted_on DATE NOT NULL,
  FOREIGN KEY (box_no) REFERENCES boxes(box_no) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS box_moves (
  id INT AUTO_INCREMENT PRIMARY KEY,
  box_no SMALLINT NOT NULL,        -- current box
  from_box SMALLINT NOT NULL,
  to_box SMALLINT NOT NULL,
  moved_on DATE NOT NULL,
  FOREIGN KEY (box_no) REFERENCES boxes(box_no) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS harvests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  harvest_date DATE NOT NULL,
  size ENUM('Large','Medium','Small','Soft shell','Other') NULL,
  total_weight_g INT NOT NULL,
  price_per_kg DECIMAL(10,2) NULL,
  buyer VARCHAR(120) NOT NULL DEFAULT '',
  notes VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- snapshot of each crab at harvest; the box row is deleted afterwards
CREATE TABLE IF NOT EXISTS harvest_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  harvest_id INT NOT NULL,
  box_no SMALLINT NOT NULL,
  batch_no VARCHAR(20) NULL,
  size VARCHAR(20) NULL,
  species VARCHAR(120) NULL,
  sex ENUM('M','F') NULL,
  stock_date DATE NULL,
  initial_weight_g INT NULL,
  final_weight_g INT NOT NULL,
  moult_count SMALLINT NOT NULL DEFAULT 0,
  cost DECIMAL(10,2) NULL,
  FOREIGN KEY (harvest_id) REFERENCES harvests(id) ON DELETE CASCADE,
  INDEX (batch_no)
);

CREATE TABLE IF NOT EXISTS harvest_files (
  id INT AUTO_INCREMENT PRIMARY KEY,
  harvest_id INT NOT NULL,
  file_name VARCHAR(200) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  size_bytes INT NOT NULL,
  FOREIGN KEY (harvest_id) REFERENCES harvests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS monitor_readings (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  recorded_at DATETIME NOT NULL,
  temperature_c DECIMAL(4,1) NULL,
  ph DECIMAL(3,1) NULL,
  source VARCHAR(80) NOT NULL DEFAULT 'manual',
  INDEX (recorded_at)
);
