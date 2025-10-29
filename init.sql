CREATE DATABASE zdjlales;
USE zdjlales;
CREATE TABLE goods (
    goods_name VARCHAR(255) PRIMARY KEY,
    Description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    stock INT NOT NULL
);
CREATE TABLE users (
    user_id INT PRIMARY KEY,
    vip_expiry_date TIMESTAMP DEFAULT '1970-01-31 00:00:00'
);
CREATE TABLE trades (
    trade_no VARCHAR(64) PRIMARY KEY,
    goods_name VARCHAR(255) NOT NULL,
    user_id INT NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    trade_status VARCHAR(30) NOT NULL,
    create_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (goods_name) REFERENCES goods(goods_name)
);
-- 下面是mysql手动操作时的常用语句，执行此sql语句时会默认创建3个示例商品(30天VIP月卡、90天VIP季卡和7天VIP周卡)

-- 插入一条默认商品
INSERT INTO goods (goods_name, Description, price, stock)
VALUES ("30天VIP月卡", "购买后VIP有效期将增加30天", 30.00, 100);

-- 插入多条商品
INSERT INTO goods (goods_name, Description, price, stock)
VALUES ("60天VIP月卡", "购买后VIP有效期将增加60天", 59.99, 100),
("90天VIP季卡", "购买后VIP有效期将增加90天", 89.99, 100),
("7天VIP周卡", "购买后VIP有效期将增加7天", 0.01, 10);

-- 移除一条商品
DELETE FROM goods WHERE goods_name='60天VIP月卡';