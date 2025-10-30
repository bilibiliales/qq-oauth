CREATE DATABASE IF NOT EXISTS zdjlales;
USE zdjlales;

CREATE TABLE qq_oauth (
    state VARCHAR(255) PRIMARY KEY,
    info JSON
);