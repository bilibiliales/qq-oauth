import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import crypto from 'crypto';
import mysql from 'mysql2/promise';

const app = express();
const HOST = '0.0.0.0';
const PORT = 3100;

// 中间件配置
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// qq互联授权配置
const qqConfig = {
  appId: '102811774', // 换成自己的appId
  appKey: '***', // 换成自己的appKey
  redirectUri: 'https://zdjlales.xyz/api/redirect', // 换成http(s)://本服务运行时访问的域名/redirect
  oauthUrl: 'https://graph.qq.com/oauth2.0/authorize', // 生成授权链接，不要动
  tokenUrl: 'https://graph.qq.com/oauth2.0/token', // 获取access token的链接，不要动
  userInfoUrl: 'https://graph.qq.com/user/get_user_info' // 获取头像和昵称的链接，不要动
};

// 创建MySQL数据库连接池
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

// 获取授权链接
app.get('/api/qq/auth/url', async (req, res) => {
  try {
    const state = crypto.randomUUID();
    const encodedRedirectUri = encodeURIComponent(qqConfig.redirectUri);

    // 构建完整授权URL
    const authUrl = `${qqConfig.oauthUrl}?response_type=code&client_id=${qqConfig.appId}&redirect_uri=${encodedRedirectUri}&state=${state}`;

    // 存储state到数据库（状态：待授权）
    const connection = await pool.getConnection();
    try {
      await connection.execute(
          'INSERT INTO qq_oauth (state, info) VALUES (:state, JSON_OBJECT("status", "pending"))',
          { state }
      );
    } finally {
      connection.release();
    }

    res.json({ auth_url: authUrl, state });
  } catch (error) {
    res.status(500).json({ error: '获取授权链接失败', message: error.message });
  }
});

// 授权结果查询
app.get('/api/qq/auth/verify', async (req, res) => {
  const { state } = req.query;
  if (!state) return res.status(400).json({ error: '缺少state参数' });

  try {
    const connection = await pool.getConnection();
    try {
      const maxWaitTime = 10000;
      const checkInterval = 1000;
      let elapsedTime = 0;
      let result = null;

      while (elapsedTime < maxWaitTime) {
        const [rows] = await connection.execute(
            'SELECT info FROM qq_oauth WHERE state = :state',
            { state }
        );

        if (rows.length === 0) {
          result = { status: 'invalid', message: 'state不存在' };
          break;
        }

        const info = rows[0].info;

        if (info.status !== 'pending') {
          if (info.status === 'completed') {
            result = {
              status: 'completed',
              data: {
                openid: info.openid,
                nickname: info.nickname,
                avatar: info.avatar
              }
            };
            await connection.execute('DELETE FROM qq_oauth WHERE state = :state', { state });
          } else {
            result = { status: info.status, message: info.message || '授权失败' };
          }
          break;
        }

        await new Promise(resolve => setTimeout(resolve, checkInterval));
        elapsedTime += checkInterval;
      }

      if (!result) {
        result = { status: 'pending', message: '授权处理中，请稍后重试' };
      }

      res.json(result);
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ error: '查询授权结果失败', message: error.message });
  }
});

// 授权回调处理
app.post('/api/qq/auth/callback', async (req, res) => {
  const { code, state } = req.body;
  if (!code || !state) {
    return res.status(400).json({ error: '缺少code或state参数' });
  }

  try {
    const connection = await pool.getConnection();
    try {
      // 验证state有效性
      const [stateRows] = await connection.execute(
          'SELECT info FROM qq_oauth WHERE state = :state',
          { state }
      );
      if (stateRows.length === 0) {
        return res.status(400).json({ error: '无效的state参数' });
      }

      // 获取access_token和openid
      const encodedRedirectUri = encodeURIComponent(qqConfig.redirectUri);
      const tokenUrl = `${qqConfig.tokenUrl}?grant_type=authorization_code&client_id=${qqConfig.appId}&client_secret=${qqConfig.appKey}&code=${code}&redirect_uri=${encodedRedirectUri}&fmt=json&need_openid=1`;

      const tokenResponse = await axios.get(tokenUrl);
      const { access_token: accessToken, openid } = tokenResponse.data;
      if (!accessToken || !openid) {
        throw new Error(`获取access_token或openid失败: ${tokenResponse.data}`);
      }

      // 获取用户信息（昵称、头像）
      const userInfoResponse = await axios.get(qqConfig.userInfoUrl, {
        params: {
          access_token: accessToken,
          oauth_consumer_key: qqConfig.appId,
          openid
        }
      });
      const userInfo = userInfoResponse.data;
      if (userInfo.ret !== 0) {
        throw new Error(`获取用户信息失败: ${userInfo.msg}`);
      }

      // 更新数据库状态（状态：已完成）
      await connection.execute(
          'UPDATE qq_oauth SET info = :info WHERE state = :state',
          {
            state,
            info: JSON.stringify({
              status: 'completed',
              openid,
              nickname: userInfo.nickname,
              avatar: userInfo.figureurl_qq
            })
          }
      );

      res.json({ success: true, message: '授权成功' });
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ error: '授权处理失败', message: error.message });
  }
});

// 授权回调HTML页面
app.get('/api/redirect', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>QQ授权回调</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="flex items-center justify-center min-h-screen bg-gray-100">
      <div class="text-center">
        <div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
        <p class="mt-4 text-gray-700">正在处理授权，请稍候...</p>
      </div>
      <script>
        // 解析URL参数并调用后端接口
        const params = new URLSearchParams(window.location.search);
        fetch('/api/qq/auth/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: params.get('code'),
            state: params.get('state')
          })
        })
        .then(res => res.json())
        .then(data => {
          document.querySelector('p').textContent = data.success ? 
            '授权成功！即将关闭窗口...' : 
            '授权失败: ' + (data.error || '未知错误');
          setTimeout(() => window.close(), 2000);
        });
      </script>
    </body>
    </html>
  `);
});

// HTML主页
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>QQ授权演示</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-100 min-h-screen">
      <nav class="bg-blue-600 text-white p-4">
        <div class="container mx-auto flex justify-between items-center">
          <h1 class="text-xl font-bold">QQ授权Demo</h1>
          <a href="/login" class="bg-white text-blue-600 px-4 py-2 rounded">登录</a>
        </div>
      </nav>
      <div class="container mx-auto p-8 text-center">
        <h2 class="text-3xl font-bold mb-8 text-gray-800">欢迎使用QQ授权服务</h2>
        <a href="/login" class="bg-blue-600 text-white px-6 py-3 rounded-lg text-lg hover:bg-blue-700 transition">
          前往登录
        </a>
      </div>
    </body>
    </html>
  `);
});

// HTML登录页
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>登录</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-100 min-h-screen flex items-center justify-center">
      <div class="bg-white p-8 rounded-lg shadow-md w-96">
        <!-- 登录表单容器（授权成功后隐藏） -->
        <div id="loginForm">
          <h2 class="text-2xl font-bold mb-6 text-center text-gray-800">账号登录</h2>
          
          <!-- 用户名密码框 -->
          <div class="mb-4">
            <label class="block text-gray-700 mb-2">用户名</label>
            <input type="text" class="w-full px-3 py-2 border rounded" placeholder="输入用户名">
          </div>
          <div class="mb-6">
            <label class="block text-gray-700 mb-2">密码</label>
            <input type="password" class="w-full px-3 py-2 border rounded" placeholder="输入密码">
          </div>
          
          <!-- 普通登录按钮 -->
          <button id="loginBtn" style="margin-bottom: 10px" class="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition flex items-center justify-center">
            登录
          </button>
          
          <!-- QQ登录按钮 -->
          <button id="qqLoginBtn" class="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition flex items-center justify-center">
            <img src="https://qzonestyle.gtimg.cn/qzone/qzact/act/external/tiqq/logo.png" alt="QQ快捷登录" style="width: 20px; height: 20px; margin-right: 10px">
              QQ快捷登录
            </img>
          </button>
          
          <div id="authResult" class="mt-4 text-center text-gray-600 hidden"></div>
        </div>
     
        <!-- 授权成功界面（初始隐藏） -->
        <div id="authSuccess" class="text-center hidden">
          <h2 class="text-2xl font-bold mb-6 text-green-600">授权成功</h2>
          
          <!-- 头像（居中） -->
          <div class="flex justify-center mb-4">
            <img id="avatarImg" src="" alt="用户头像" class="w-32 h-32 rounded-full border-4 border-blue-100 object-cover">
          </div>
          
          <!-- 昵称 -->
          <h3 id="nicknameText" class="text-xl font-semibold text-gray-800 mb-6"></h3>
          
          <!-- 确定按钮 -->
          <button id="confirmBtn" class="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition mb-4">
            确定
          </button>
          
          <!-- OpenID小字 -->
          <p id="openidText" class="text-xs text-gray-500 mt-2"></p>
        </div>
     
      <script>
        // 长轮询检查授权结果
        const checkAuthResult = (state) => {
          const authResult = document.getElementById('authResult');
          const loginForm = document.getElementById('loginForm');
          const authSuccess = document.getElementById('authSuccess');
          const avatarImg = document.getElementById('avatarImg');
          const nicknameText = document.getElementById('nicknameText');
          const openidText = document.getElementById('openidText');
          
          authResult.classList.remove('hidden');
          
          fetch(\`/api/qq/auth/verify?state=\${state}\`)
            .then(res => res.json())
            .then(result => {
              switch (result.status) {
                case 'completed': {
                  // 隐藏登录表单，显示授权成功界面
                  loginForm.classList.add('hidden');
                  authSuccess.classList.remove('hidden');
                  
                  // 填充数据
                  avatarImg.src = result.data.avatar || 'https://via.placeholder.com/128'; // 默认头像
                  nicknameText.textContent = result.data.nickname || '未知用户';
                  openidText.textContent = \`QQ账号唯一标识: \${result.data.openid}\`;
                  
                  // 确定按钮事件
                  document.getElementById('confirmBtn').addEventListener('click', () => {
                    window.location.href = '/';
                  });
                  break;
                }
                case 'pending': {
                  authResult.textContent = '授权处理中...';
                  setTimeout(() => checkAuthResult(state), 10000);
                  break;
                }
                default: {
                  authResult.textContent = \`授权失败: \${result.message || '未知错误'}\`;
                }
              }
            })
            .catch(error => {
              authResult.textContent = \`查询失败: \${error.message}\`;
              setTimeout(() => checkAuthResult(state), 10000); // 出错重试
            });
        };
        
        // 普通登录
        document.getElementById('loginBtn').addEventListener('click', () => {
          alert("登录失败，请稍后重试");
        });
 
        // 点击QQ登录按钮触发授权
        document.getElementById('qqLoginBtn').addEventListener('click', () => {
          fetch('/api/qq/auth/url')
            .then(res => res.json())
            .then(data => {
              if (data.auth_url) {
                // 打开QQ授权窗口
                const authWindow = window.open(
                  data.auth_url,
                  'QQ授权',
                  'width=800,height=600'
                );
                // 开始长轮询检查结果
                checkAuthResult(data.state);
              }
            })
            .catch(error => {
              document.getElementById('authResult').textContent = \`获取授权链接失败: \${error.message}\`;
            });
        });
      </script>
    </body>
    </html>
  `);
});

// 启动服务
app.listen(PORT, HOST, () => {
  console.log(`服务器已启动，运行地址：http://${HOST}:${PORT}`);
});
