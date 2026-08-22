# FeedbackServer 受邀管理员接入指南

你收到的是一个一次性管理员邀请码。它只能使用一次，并且会过期。你可以把邀请人发来的整段接入消息交给 Codex 或 Claude Code，让 Agent 安装插件、克隆仓库并准备准确的接入命令。最后的 `accept-invite` 命令需要隐藏输入新密码，因此必须由你在自己可见、可控制的交互式终端中运行。

请不要把你的管理员密码或之后生成的 PAT 发到聊天机器人、工单、代码仓库、截图或共享文档里。密码仍然只应该输入到终端的隐藏提示里。

## 你会获得什么权限

接受邀请后，你会创建自己的 FeedbackServer 管理员账号，并在本机配置一个 Agent 凭据。这个账号默认是普通 `admin`，初始没有任何 Product，也不能访问邀请人的 Product。邀请消息会分别列出邀请码过期时间、初始套餐和套餐期限；它们不是同一个期限。Free 没有付费期限，Solo/Studio 的一个月、一个年或永久期限从接受成功时才开始。

如果你需要管理某个 App，请让邀请人之后为你的账号创建或授权对应的 Product。当前版本不提供共享同一个 Product 的协作权限。

## 准备

请确认你的机器上已经有：

- macOS
- Git
- Bun 1.3 或更新版本
- Codex 或 Claude Code

如果你已经在这台机器上配置过 FeedbackServer Agent，接入流程会先展示当前的非敏感用户名和服务地址，并让你选择保留原账号还是切换到受邀账号。该 Keychain 账号由这台 Mac 上所有启用 FeedbackServer 的 Codex 和 Claude 会话共享，切换并非只影响当前项目。默认选择是保留：命令会停止，不询问新密码，也不会消耗邀请码。

只有明确输入 `switch` 才会切换。切换会验证当前账号密码、撤销当前 Agent PAT、删除本机共享旧凭据，然后尝试接受邀请。若接受失败且尚未生成新的有效凭据，CLI 会用刚才隐藏输入的当前账号密码自动尝试恢复原账号；只有自动恢复也失败时，才需要运行 `feedback-server agent configure` 手动恢复。

## 1. 安装 Agent 插件

如果你用 Codex：

```bash
codex plugin marketplace list --json
codex plugin list --json
```

如果列表中没有 `feedback-server` marketplace，再执行：

```bash
codex plugin marketplace add Rabithua/FeedbackServerPlugin --ref main
```

如果 marketplace 已存在，执行升级，不要重复添加：

```bash
codex plugin marketplace upgrade feedback-server
```

只有插件列表中没有 `feedback-server@feedback-server` 时才安装：

```bash
codex plugin add feedback-server@feedback-server
```

如果你用 Claude Code：

```bash
claude plugin marketplace add Rabithua/FeedbackServerPlugin
claude plugin install feedback-server@feedback-server --scope user
```

安装后先不用开新会话，等下面账号接入完成后再打开新的 Codex 或 Claude Code 会话。

Codex 或 Claude Code 可能会在执行安装命令前请求授权。请在当前任务中亲自核对并批准；另一个任务或 Agent 不能代替你批准。授权完成后，原任务才会继续准备接入命令。

## 2. 接受邀请并配置本机凭据

克隆公开插件仓库：

```bash
git clone https://github.com/Rabithua/FeedbackServerPlugin.git
cd FeedbackServerPlugin
```

如果邀请人发给你的是完整接入消息，最简单的方式是把整段消息发给 Codex 或 Claude Code。Agent 可以安装插件、克隆仓库、询问用户名和显示名，并根据仓库的真实绝对路径生成下面的完整命令。

Agent 不应在自己的进程、私有 PTY 或其他你看不到的终端中运行 `accept-invite`。请打开自己可见、可控制的交互式终端，先进入 Agent 告诉你的仓库绝对路径，再运行它准备好的接入命令。这样 CLI 才能安全地隐藏密码输入，并且密码不会经过聊天。

如果当前 Agent 会话可以检查 `connection_status`，它应先展示已有账号的非敏感身份，说明切换会影响这台 Mac 上所有 FeedbackServer Agent 会话，再询问你要保留还是切换；Agent 不能替你选择。如果当前会话还不能使用该工具，CLI 会在接入命令开始时完成同样的确认。选择保留后流程立即停止；选择切换时还需要在隐藏提示中输入当前账号密码。

如果你不使用 Agent 准备命令，请在可见终端中执行下面两步，并把 `YOUR_INVITATION_TOKEN`、`YOUR_USERNAME` 和 `Your Display Name` 换成邀请消息里的邀请码，以及你想使用的管理员用户名和显示名：

```bash
cd "/absolute/path/to/FeedbackServerPlugin"
plugins/feedback-server/bin/feedback-server admin accept-invite \
  --url https://api.feedkit.cn/v1/api \
  --token YOUR_INVITATION_TOKEN \
  --username YOUR_USERNAME \
  --display-name "Your Display Name"
```

不要省略第一条 `cd`，也不要从克隆目录的上一级直接运行相对路径。没有现有账号时，接入命令会依次隐藏输入：

- 你的新管理员密码
- 再输入一次密码确认

如果已有账号，CLI 会先显示当前用户名和服务地址，并默认选择 `keep`。选择 `keep` 不会询问密码或消耗邀请码；只有明确输入 `switch` 才会继续。切换流程会隐藏输入新管理员密码、密码确认和当前管理员密码。

成功后，命令会自动完成这些事：

- 创建你的普通 `admin` 账号
- 验证这个账号可以登录
- 验证你初始没有 Product
- 创建一个 365 天有效的 Agent PAT
- 把 Agent 凭据写入 macOS Keychain
- 注销临时登录会话

成功文案还会显示 Server 实际应用的套餐。固定期限会同时显示到期时间和 7 天宽限结束
时间；这份服务端结果才是授权成功的依据，不要仅凭邀请消息里的声明判断。

成功文案会明确说明“账号连接完成”不等于“应用配置完成”。按提示打开一个新的 Codex 或
Claude Code 任务，并发送：

```text
帮我完成 FeedbackServer 初始配置
```

Agent 会从实时服务端状态开始，每次只引导一个下一步；不会在本地保存“完成”或“跳过”标记。

如果你不想让邀请码出现在命令里，也可以省略 `--token`，命令会改为从隐藏输入读取一次性邀请码。

## 3. 验证连接

先在插件仓库中运行只读预检：

```bash
plugins/feedback-server/bin/feedback-server doctor
```

它会检查插件版本、Agent 凭据、PAT 权限与有效期、服务健康状态和可见 Product，不会输出
密码、PAT 或 Product Key。如果账号有多个 Product，请明确指定 ID 或 slug：

```bash
plugins/feedback-server/bin/feedback-server doctor --product YOUR_PRODUCT_SLUG
```

打开一个新的 Codex 或 Claude Code 会话，然后让 Agent 执行：

```text
帮我完成 FeedbackServer 初始配置
```

首次接入成功时，通常会看到：

- 账号名是你刚创建的用户名
- 服务健康状态为 `ok`
- Product 列表为空

Product 列表为空是正常的。Agent 会询问 App 名称、slug 和默认语言，并为这个独立账号创建
第一个 Product；新管理员账号默认不能看到邀请人的 App。

Product 和 App 接入完成后，可以用 `doctor --product YOUR_PRODUCT_SLUG --app-path
/absolute/path/to/App` 检查 FeedbackKit 版本、服务地址、Product 绑定、语言策略和 Visitor
Keychain service。只有在你明确需要真实回环验收时，才运行下面的命令；它要求重复输入
Product slug，随后测试提交、管理端接收、回复、未读和已读，并删除这次随机 Visitor 及其
反馈：

```bash
plugins/feedback-server/bin/feedback-server test roundtrip \
  --product YOUR_PRODUCT_SLUG \
  --confirm YOUR_PRODUCT_SLUG
```

## 常见问题

### 提示已经配置过 Agent

这台机器上已经有 FeedbackServer Agent 凭据。CLI 会展示当前的非敏感用户名和服务地址，并询问保留还是切换。

- 直接回车或输入 `keep`：保留原账号并停止，邀请码不会被使用。
- 明确输入 `switch`：验证当前账号密码，撤销共享旧 PAT 并删除旧凭据，然后接受邀请；失败时 CLI 会自动尝试恢复原账号。

也可以先单独移除旧账号，再重新运行接入命令：

```bash
plugins/feedback-server/bin/feedback-server agent disconnect
```

然后再重新接受邀请。

### 账号创建了，但本机 Agent 配置失败

不要再次使用同一个邀请码。请改用你刚创建的用户名运行：

```bash
plugins/feedback-server/bin/feedback-server agent configure \
  --url https://api.feedkit.cn/v1/api \
  --username YOUR_USERNAME
```

### 邀请码过期、已被使用或被撤销

请让邀请人重新创建一个邀请码。

### 我需要管理某个 App

接受邀请只会创建你的管理员账号，不会自动授予别人 Product 的访问权。请为自己的 App
创建 Product；如果需要管理其他管理员拥有的 Product，则要等待服务端支持 Product 协作授权。
