import express from 'express';
import bodyParser from 'body-parser';
import { AlipaySdk } from 'alipay-sdk';
import { config } from './config_mysql.js';
import { db } from './database_mysql.js';

const app = express();
const PORT = 3000;

// 中间件
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// 支付宝配置
const alipaySdk = new AlipaySdk({
  appId: config.appId,
  privateKey: config.privateKey,
  alipayPublicKey: config.alipayPublicKey,
  gateway: config.gatewayUrl
});

// VIP时间计算
const calculateVipDate = (currentDate, goodsName) => {
  const durationMap = {
    '30天VIP月卡': 30 * 86400 * 1000,
    '90天VIP季卡': 90 * 86400 * 1000,
    '7天VIP周卡' : 7  * 86400 * 1000 
  };
  const now = new Date();
  const baseDate = currentDate && currentDate > now ? currentDate : now;
  return new Date(baseDate.getTime() + (durationMap[goodsName] || 0));
};

// 商品列表接口
app.get('/goods', async (req, res) => {
  try {
    const goodsList = await db.getGoodsList();
    res.json(goodsList);
  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

// VIP查询接口
app.get('/vip', async (req, res) => {
  try {
    const userId = req.query.uid;
    if (!userId) throw new Error('缺少用户ID');
    
    const expiryDate = await db.getVipExpiryDate(userId);
    res.json({ expiryDate });
  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

// 用户注册接口
app.get('/regist', async (req, res) => {
  try {
    const userId = req.query.uid;
    if (!userId) throw new Error('参数错误');

    const exist = await db.getVipExpiryDate(userId);
    if (exist === null) {
      const result = await db.createUser(userId);
      if (result === "SUCCESS") {
        return res.status(200).json({ status: "SUCCESS" });
      }
      throw new Error('用户创建失败');
    }
    res.status(200).json({ status: "HasRegisted" });
  } catch (error) {
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

// 订单创建接口
app.post('/createTrade', async (req, res) => {
  try {
    const { userId, goodsName } = req.body;
    
    // 参数校验
    if (!userId || !goodsName) {
      return res.status(400).json({ error: '参数不完整' });
    }

    // 并行校验用户和商品
    const [userExist, stock] = await Promise.all([
      db.getVipExpiryDate(userId),
      db.getGoodsStock(goodsName)
    ]);

    if (!userExist) return res.status(200).json({ status: "NO_USER" });
    if (stock === null) return res.status(200).json({ status: "NO_GOODS" });

    // 检查15分钟内是否存在同名未支付订单
    const existingOrderId = await db.getUnpaidOrder(userId, goodsName, 15);
    if (existingOrderId) {
      const payUrl = alipaySdk.pageExec("alipay.trade.wap.pay", "GET", {
        bizContent: {
          out_trade_no: existingOrderId.trade_no,
          total_amount: existingOrderId.total_amount,
          subject: existingOrderId.goods_name,
          product_code: "QUICK_WAP_WAY",
          seller_id: "2088721011046051",
        },
        notify_url: "http://47.96.116.182:3000/notify",
        return_url: "http://47.96.116.182:3000/return",
      });
      return res.status(200).json({ status: payUrl });
    } 
    // 生成新的订单
    else {
        // 让之前有未支付订单的用户能够忽略库存限制
        if (stock <= 0) return res.status(200).json({ status: "SOLD_OUT" });

        // 库存减少操作
        const reduceResult = await db.reduceGoodsStock(goodsName);
        if (reduceResult !== "SUCCESS") {
          return res.status(200).json({ status: "SOLD_OUT" });
        }

        try {
            // 生成订单信息
            const totalAmount = await db.getGoodsPrice(goodsName);
            const outTradeNo = `zdjlales${Date.now()}${userId}`;
            // 支付宝请求
            const payUrl = alipaySdk.pageExec("alipay.trade.wap.pay", "GET", {
            bizContent: {
                out_trade_no: outTradeNo,
                total_amount: totalAmount,
                subject: goodsName,
                product_code: "QUICK_WAP_WAY",
                seller_id: "2088721011046051",
            },
            notify_url: "http://47.96.116.182:3000/notify",
            return_url: "http://47.96.116.182:3000/return",
            });

            // 创建订单记录
            await db.createTrade(outTradeNo, goodsName, userId, totalAmount);
            return res.status(200).json({ status: payUrl });
        } catch (error) {
            // 恢复库存
            await db.plusGoodsStockByGoodsName(goodsName);
            res.status(500).json({ 
                error: 'Internal Server Error', 
                message: error.message 
            });
        }
    }
  } catch (error) {
    console.error(error)
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: error.message 
    });
  }
});

// 异步通知接口
app.post('/notify', async (req, res) => {
  try {
    const { out_trade_no, trade_status } = req.body;
    
    // 基础校验
    if (!out_trade_no || !trade_status) {
      console.error('无效通知参数');
      return res.send('fail');
    }

    // 验签校验
    if (!alipaySdk.checkNotifySign(req.body)) {
      console.error('验签失败:', out_trade_no);
      return res.send('fail');
    }

    // 获取订单状态
    const currentStatus = await db.getTradeStatusById(out_trade_no);
    if (!currentStatus) {
      console.error('订单不存在:', out_trade_no);
      return res.send('fail');
    }

    // 处理交易关闭
    if (trade_status === 'TRADE_CLOSED') {
      if (currentStatus === 'WAIT_BUYER_PAY') {
        await db.plusGoodsStockByTradeId(out_trade_no);
      }
      return res.send('success');
    }

    // 处理交易成功
    if (['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(trade_status)) {
      if (currentStatus === 'TRADE_SUCCESS') {
        return res.send('success'); // 防止重复处理
      }

      // 更新订单状态
      const updateResult = await db.updateTradeStatus(out_trade_no, 'TRADE_SUCCESS');
      if (updateResult !== "SUCCESS") {
        throw new Error('订单状态更新失败');
      }

      // 更新VIP有效期
      const user = await db.getTradeUser(out_trade_no);
      const goods = await db.getTradeGoods(out_trade_no);
      const currentExpiry = await db.getVipExpiryDate(user);
      const newExpiry = calculateVipDate(currentExpiry, goods.name);
      
      await db.updateUserVipExpiryDate(user, newExpiry);
    }

    res.send('success');
  } catch (error) {
    console.error('通知处理异常:', error);
    res.send('fail');
  }
});

// 同步返回接口
app.get('/return', async (req, res) => {
  try {
    const { out_trade_no } = req.query;

    // 参数校验
    if (!out_trade_no) {
      return res.send("订单号参数缺失");
    }
    // 验签校验
    if (!alipaySdk.checkNotifySign(req.query)) {
      return res.send("验签失败，请勿重复提交");
    }
    // 获取订单详情
    const status = await db.getTradeStatusById(out_trade_no);
    const goodsInfo = await db.getTradeGoods(out_trade_no);
    const expiryDate = await db.getVipExpiryDate(await db.getTradeUser(out_trade_no));
    // 构建响应信息
    let message;
    switch(status) {
      case 'TRADE_SUCCESS':
        message = `支付成功！您已成功购买${goodsInfo.name}，VIP有效期至${expiryDate}`;
        break;
      case 'WAIT_BUYER_PAY':
        message = "等待支付中，若已完成支付请稍后刷新";
        break;
      default:
        message = "支付状态异常，请联系客服";
    }
    res.send(`
      <h2>支付结果通知</h2>
      <p>${message}</p>
      <p>订单号：${out_trade_no}</p>
    `);
  } catch (error) {
    console.error(error)
    res.send("系统繁忙，请稍后再试");
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`MySQL适配版服务器已启动，端口：${PORT}`);
});