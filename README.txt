##说明：
本demo使用node.js + mysql技术栈模拟在原有账号体系下引入第三方授权的绑定及登录的方案
min版本将仅返回openid，由脚本端验证openid的有效性

使用方式：
打开config.js，将参数替换为自己的实际参数

在项目终端中输入命令：
> node app.js

min版使用方式：
> cd min
> node min.js

导入初始化数据库方式：
在项目终端登录mysql，然后使用以下命令：
mysql> source init.sql