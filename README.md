# 服务人员网页端

打开 `login.html` 登录后会跳转到 `index.html` 服务工作台。直接访问 `index.html` 且没有登录会话时，也会自动跳回登录页。也可以在本目录运行一个静态服务器：

```powershell
python -m http.server 8090
```

然后访问 `http://127.0.0.1:8090/`。

## 模式说明

- 云端工作模式：通过 `ws://8.148.79.98:8083/mqtt` 连接 MQTT Broker，与 `Cloud_AI_Engine` 的工单主题联动。

页面中的“清理已结束”只会把已完成、已确认和已取消工单从当前工作列表隐藏，云端数据库和操作记录不会删除；可通过“恢复已清理”重新显示。

`mqtt.min.js` 已随网页一起保存，不依赖第三方 CDN。

## 工单权限

- 待接单工单：任何已登录服务人员可以接单。
- 已接单/已到达：仅原接单人员或管理员可以继续操作。
- 服务人员完成后状态为 `completed`，最终 `resolved` 由患者床旁按钮确认。

## 当前原型账号

- `STAFF-001` / PIN `1001`
- `STAFF-002` / PIN `1002`
- `ADMIN-001` / PIN `9001`

这些 PIN 只用于当前原型。正式部署应由服务端登录接口签发会话，不能在前端保存真实人员密码。

## MQTT 主题

- 订阅：`smart_care/ticket/status`、`smart_care/ticket/snapshot`、`smart_care/result`
- 发布：`smart_care/ticket/action`、`smart_care/ticket/query`
