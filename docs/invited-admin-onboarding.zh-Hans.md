# FeedbackServer 受邀管理员接入指南

你收到的是一个一次性管理员邀请码。它只能使用一次，并且会过期。你可以把邀请人发来的整段接入消息交给 Codex 或 Claude Code 处理。

请不要把你的管理员密码或之后生成的 PAT 发到聊天机器人、工单、代码仓库、截图或共享文档里。密码仍然只应该输入到终端的隐藏提示里。

## 你会获得什么权限

接受邀请后，你会创建自己的 FeedbackServer 管理员账号，并在本机配置一个 Agent 凭据。这个账号默认是普通 `admin`，初始没有任何 Product，也不能访问邀请人的 Product。

如果你需要管理某个 App，请让邀请人之后为你的账号创建或授权对应的 Product。当前版本不提供共享同一个 Product 的协作权限。

## 准备

请确认你的机器上已经有：

- macOS
- Git
- Bun 1.3 或更新版本
- Codex 或 Claude Code

如果你已经在这台机器上配置过 FeedbackServer Agent，请先不要继续接受邀请码。`accept-invite` 会拒绝覆盖已有凭据，避免误把另一个账号顶掉。

## 1. 安装 Agent 插件

如果你用 Codex：

```bash
codex plugin marketplace add Rabithua/FeedbackServerPlugin --ref main
codex plugin add feedback-server@feedback-server
```

如果你用 Claude Code：

```bash
claude plugin marketplace add Rabithua/FeedbackServerPlugin
claude plugin install feedback-server@feedback-server --scope user
```

安装后先不用开新会话，等下面账号接入完成后再打开新的 Codex 或 Claude Code 会话。

## 2. 接受邀请并配置本机凭据

克隆公开插件仓库：

```bash
git clone https://github.com/Rabithua/FeedbackServerPlugin.git
cd FeedbackServerPlugin
```

如果邀请人发给你的是完整接入消息，最简单的方式是把整段消息发给 Codex 或 Claude Code，让 Agent 安装插件并运行接受邀请命令。邀请码可以由 Agent 从接入消息里读取；密码仍然只在隐藏提示里输入。

如果你想手动执行，把下面的 `YOUR_INVITATION_TOKEN`、`YOUR_USERNAME` 和 `Your Display Name` 换成邀请消息里的邀请码，以及你想使用的管理员用户名和显示名：

```bash
plugins/feedback-server/bin/feedback-server admin accept-invite \
  --url https://feedbackserver.rote.ink/v1/api \
  --token YOUR_INVITATION_TOKEN \
  --username YOUR_USERNAME \
  --display-name "Your Display Name"
```

命令会依次隐藏输入：

- 你的新管理员密码
- 再输入一次密码确认

成功后，命令会自动完成这些事：

- 创建你的普通 `admin` 账号
- 验证这个账号可以登录
- 验证你初始没有 Product
- 创建一个 365 天有效的 Agent PAT
- 把 Agent 凭据写入 macOS Keychain
- 注销临时登录会话

如果你不想让邀请码出现在命令里，也可以省略 `--token`，命令会改为从隐藏输入读取一次性邀请码。

## 3. 验证连接

打开一个新的 Codex 或 Claude Code 会话，然后让 Agent 执行：

```text
检查 FeedbackServer connection_status，并列出我的 Products
```

首次接入成功时，通常会看到：

- 账号名是你刚创建的用户名
- 服务健康状态为 `ok`
- Product 列表为空

Product 列表为空是正常的。新管理员账号默认不能看到邀请人的 App。

## 常见问题

### 提示已经配置过 Agent

这台机器上已经有 FeedbackServer Agent 凭据。不要重复使用邀请码。请先联系邀请人确认要保留哪个账号。

如果确实要移除旧账号，请在确认后运行：

```bash
plugins/feedback-server/bin/feedback-server agent disconnect
```

然后再重新接受邀请。

### 账号创建了，但本机 Agent 配置失败

不要再次使用同一个邀请码。请改用你刚创建的用户名运行：

```bash
plugins/feedback-server/bin/feedback-server agent configure \
  --url https://feedbackserver.rote.ink/v1/api \
  --username YOUR_USERNAME
```

### 邀请码过期、已被使用或被撤销

请让邀请人重新创建一个邀请码。

### 我需要管理某个 App

接受邀请只会创建你的管理员账号，不会自动授予别人 Product 的访问权。请让邀请人为你创建对应 Product，或等待服务端支持 Product 协作授权。
