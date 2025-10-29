import mysql from 'mysql2/promise';

// 创建数据库连接池
const pool = mysql.createPool({
  host: '127.0.0.1',
  user: 'sa',
  password: 'a1b2c3',
  database: 'zdjlales',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  namedPlaceholders: true
});

class DB {
  // 获取商品列表
  async getGoodsList() {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query('SELECT * FROM goods');
      return rows;
    } catch (error) {
      console.error('Error fetching goods list:', error);
      throw new Error('DB_QUERY_FAILED');
    } finally {
      conn.release();
    }
  }

  // 查询商品库存
  async getGoodsStock(goodsName) {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query(
        `SELECT stock FROM goods 
         WHERE goods_name = :goodsName`,
        { goodsName }
      );
      return rows[0]?.stock ?? null;
    } catch (error) {
      console.error('Error getting goods stock:', error);
      throw new Error('DB_QUERY_FAILED');
    } finally {
      conn.release();
    }
  }

  // 获取商品价格
  async getGoodsPrice(goodsName) {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT price FROM goods
         WHERE goods_name = ?`,
        [goodsName]
      );
      return rows[0]?.price ?? null;
    } catch (error) {
      console.error('Price query failed:', error);
      throw new Error('PRICE_QUERY_FAILED');
    } finally {
      conn.release();
    }
  }

  // 减少商品库存
  async reduceGoodsStock(goodsName) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      
      // 行级锁确保数据一致性
      const [checkRows] = await conn.query(
        `SELECT stock FROM goods 
         WHERE goods_name = :goodsName 
         FOR UPDATE`,
        { goodsName }
      );
      
      if (!checkRows.length || checkRows[0].stock <= 0) {
        await conn.rollback();
        return "STOCK_OUT";
      }

      const [updateResult] = await conn.query(
        `UPDATE goods SET stock = stock - 1 
         WHERE goods_name = :goodsName 
         AND stock > 0`,
        { goodsName }
      );

      if (updateResult.affectedRows === 0) {
        await conn.rollback();
        return "STOCK_OUT";
      }

      await conn.commit();
      return "SUCCESS";
    } catch (error) {
      await conn.rollback();
      console.error('Transaction failed:', error);
      throw new Error('TRANSACTION_FAILED');
    } finally {
      conn.release();
    }
  }

  // 回收库存
  async plusGoodsStockByTradeId(tradeId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 获取订单信息
      const [tradeRows] = await conn.query(
        `SELECT goods_name, trade_status 
         FROM trades 
         WHERE trade_no = :tradeId 
         FOR UPDATE`,
        { tradeId }
      );
      
      if (!tradeRows.length) {
        await conn.rollback();
        return "TRADE_NOT_FOUND";
      }

      if (tradeRows[0].trade_status === 'TRADE_CLOSED') {
        await conn.rollback();
        return "TRADE_ALREADY_CLOSED";
      }

      // 更新订单状态
      await conn.query(
        `UPDATE trades 
         SET trade_status = 'TRADE_CLOSED', 
             send_pay_date = NOW() 
         WHERE trade_no = :tradeId`,
        { tradeId }
      );

      // 增加库存
      await conn.query(
        `UPDATE goods SET stock = stock + 1 
         WHERE goods_name = :goodsName`,
        { goodsName: tradeRows[0].goods_name }
      );

      await conn.commit();
      return "SUCCESS";
    } catch (error) {
      await conn.rollback();
      console.error('Compensation failed:', error);
      throw new Error('COMPENSATION_FAILED');
    } finally {
      conn.release();
    }
  }

  // 回退库存
  async plusGoodsStockByGoodsName(goodsName) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE goods SET stock = stock + 1 WHERE goods_name = ?`,
        [goodsName]
      );
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  // 获取用户VIP过期时间
  async getVipExpiryDate(userId) {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query(
        `SELECT vip_expiry_date FROM users 
         WHERE user_id = ?`,
        [userId]
      );
      return rows[0]?.vip_expiry_date ?? null;
    } catch (error) {
      console.error('VIP expiry query failed:', error);
      throw new Error('VIP_QUERY_FAILED');
    } finally {
      conn.release();
    }
  }

  // 查询单个订单状态
  async getTradeStatusById(tradeId) {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query(
        `SELECT trade_status FROM trades 
         WHERE trade_no = ? `,
        [tradeId]
      );
      return rows[0]?.trade_status ?? null;
    } catch (error) {
      console.error('Trade status query failed:', error);
      throw new Error('TRADE_QUERY_FAILED');
    } finally {
      conn.release();
    }
  }

  // 查询订单发起人
  async getTradeUser(tradeId) {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT user_id FROM trades 
         WHERE trade_no = ? `,
        [tradeId]
      );
      return rows[0]?.user_id ?? null;
    } catch (error) {
      console.error('User query failed:', error);
      throw new Error('USER_QUERY_FAILED');
    } finally {
      conn.release();
    }
  }
 
  // 查询订单商品
  async getTradeGoods(tradeId) {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT g.goods_name, g.price as original_price,
                t.total_amount as actual_price  
         FROM trades t
         JOIN goods g ON t.goods_name = g.goods_name
         WHERE t.trade_no = ?`,
        [tradeId]
      );
      return rows[0] ? {
        name: rows[0].goods_name,
        originalPrice: rows[0].original_price,
        actualPrice: rows[0].actual_price
      } : null;
    } catch (error) {
      console.error('Goods query failed:', error);
      throw new Error('GOODS_QUERY_FAILED');
    } finally {
      conn.release();
    }
  }

  // 查询有无商品同名指定分钟内未支付订单
  async getUnpaidOrder(userId, goodsName, minutes) {
    const [rows] = await pool.query(
      `SELECT * FROM trades 
       WHERE user_id = ? 
       AND goods_name = ?
       AND trade_status = 'WAIT_BUYER_PAY' 
       AND create_date >= NOW() - INTERVAL ? MINUTE 
       LIMIT 1`,
      [userId, goodsName, minutes]
    );
    return rows[0] || null;
  }
  
  // 创建订单
  async createTrade(tradeId, goodsName, userId, totalAmount) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      
      // 验证用户存在性
      const [userCheck] = await conn.query(
        `SELECT 1 FROM users 
         WHERE user_id = :userId 
         LIMIT 1`,
        { userId }
      );
      
      if (!userCheck.length) {
        await conn.rollback();
        return "USER_NOT_EXIST";
      }

      // 创建交易记录
      await conn.query(
        `INSERT INTO trades 
          (trade_no, goods_name, user_id, total_amount, trade_status)
         VALUES (:tradeId, :goodsName, :userId, :totalAmount, 'WAIT_BUYER_PAY')`,
        { tradeId, goodsName, userId, totalAmount }
      );

      await conn.commit();
      return "SUCCESS";
    } catch (error) {
      await conn.rollback();
      if (error.code === 'ER_DUP_ENTRY') {
        return "TRADE_EXIST";
      }
      console.error('Create trade failed:', error);
      throw new Error('CREATE_TRADE_FAILED');
    } finally {
      conn.release();
    }
  }

  // 更新用户VIP时间
  async updateUserVipExpiryDate(userId, newDate) {
    const conn = await pool.getConnection();
    try {
      const [result] = await conn.query(
        `UPDATE users 
         SET vip_expiry_date = CONVERT_TZ(:newDate, '+00:00', @@session.time_zone)
         WHERE user_id = :userId`,
        { newDate, userId }
      );
      return result.affectedRows > 0 ? "SUCCESS" : "USER_NOT_FOUND";
    } catch (error) {
      console.error('Update VIP failed:', error);
      throw new Error('UPDATE_VIP_FAILED');
    } finally {
      conn.release();
    }
  }

  // 修改订单状态
  async updateTradeStatus(tradeId, status) {
    const validTransitions = {
      'WAIT_BUYER_PAY': ['TRADE_CLOSED', 'TRADE_SUCCESS'],
      'TRADE_SUCCESS': ['TRADE_FINISHED'],
      'TRADE_FINISHED': []
    };
 
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
 
      // 获取当前状态并锁定记录
      const [current] = await conn.query(
        `SELECT trade_status FROM trades 
         WHERE trade_no = ? FOR UPDATE`,
        [tradeId]
      );
 
      if (!current.length) {
        await conn.rollback();
        return "TRADE_NOT_EXIST";
      }
 
      const currentStatus = current[0].trade_status;
      
      // 状态转移校验
      if (!validTransitions[currentStatus]?.includes(status)) {
        await conn.rollback();
        return "INVALID_STATUS_TRANSITION";
      }
 
      // 执行状态更新
      const [result] = await conn.query(
        `UPDATE trades SET 
          trade_status = ?
         WHERE trade_no = ?`,
        [status, tradeId]
      );
 
      await conn.commit();
      return result.affectedRows > 0 ? "SUCCESS" : "NO_CHANGE";
    } catch (error) {
      await conn.rollback();
      console.error('Status update failed:', error);
      throw new Error('STATUS_UPDATE_FAILED');
    } finally {
      conn.release();
    }
  }
 
  // 创建用户
  async createUser(userId) {
    const lockKey = `user_create:${userId}`;
    const conn = await pool.getConnection();
    
    try {
      // 获取分布式锁（基于MySQL的GET_LOCK）
      const [lockResult] = await conn.query(
        `SELECT GET_LOCK(?, 5) as locked`,
        [lockKey]
      );
 
      if (!lockResult[0].locked) {
        return "OPERATION_TIMEOUT";
      }
 
      // 检查用户是否存在
      const [check] = await conn.query(
        `SELECT 1 FROM users WHERE user_id = ?`,
        [userId]
      );
 
      if (check.length) {
        await conn.query(`SELECT RELEASE_LOCK(?)`, [lockKey]);
        return "USER_EXISTS";
      }
 
      // 创建用户
      const [result] = await conn.query(
        `INSERT INTO users (user_id) VALUES (?)`,
        [userId]
      );
 
      await conn.query(`SELECT RELEASE_LOCK(?)`, [lockKey]);
      return result.affectedRows > 0 ? "SUCCESS" : "CREATE_FAILED";
    } catch (error) {
      await conn.query(`SELECT RELEASE_LOCK(?)`, [lockKey]);
      if (error.code === 'ER_DUP_ENTRY') {
        return "USER_EXISTS";
      }
      console.error('User creation failed:', error);
      throw new Error('USER_CREATION_FAILED');
    } finally {
      conn.release();
    }
  }

}

export const db = new DB();