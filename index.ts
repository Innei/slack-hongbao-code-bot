import { App } from '@slack/bolt'
import dotenv from 'dotenv'

// 加载环境变量
dotenv.config()

// 初始化 Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
})

// 正则表达式匹配支付宝红包码
const alipayRedPacketPattern = /(?:支付宝)?红包码[：:]\s*([A-Za-z0-9]{10,})/

// 存储消息历史的 Map
const messageHistory = new Map<string, Array<{ text: string; ts: string }>>()

// 添加 Response 类型声明
interface OllamaResponse {
  response: string
}

// AI 分析函数
async function analyzeWithAI(messages: string): Promise<string> {
  const prompt = `
作为一个专门分析消息的AI助手，请仔细分析以下聊天内容，判断是否包含支付宝红包码。
如果包含，请提取出完整的红包码。如果不包含，请回复"未发现红包码"。

聊天内容：
${messages}

请只返回以下两种格式之一：
1. 红包码：[红包码内容]
2. 未发现红包码
`

  try {
    const response = await fetch(`${process.env.OLLAMA_API_URL}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'mistral',
        prompt,
        stream: false,
      }),
    })

    const data = (await response.json()) as OllamaResponse
    return data.response
  } catch (error) {
    console.error('AI 分析错误:', error)
    return '分析失败'
  }
}

// 监听所有消息事件
app.message(async ({ message, client, say }) => {
  try {
    const typedMessage = message
    const channelId = typedMessage.channel
    const messageText = 'text' in typedMessage ? typedMessage.text : ''
    console.log(`${channelId}: ${messageText}`)
    if (!messageText) {
      return
    }
    const messageTs = typedMessage.ts

    // 更新消息历史
    if (!messageHistory.has(channelId)) {
      messageHistory.set(channelId, [])
    }

    const channelHistory = messageHistory.get(channelId)!
    channelHistory.push({ text: messageText, ts: messageTs })

    // 只保留最近 5 条消息
    if (channelHistory.length > 5) {
      channelHistory.shift()
    }

    // 获取上下文消息
    const contextMessages = channelHistory.map((msg) => msg.text).join('\n')

    // 首先使用正则表达式快速检查
    const regexMatch = contextMessages.match(alipayRedPacketPattern)
    if (regexMatch) {
      const redPacketCode = regexMatch[1]
      await say({
        text: `${redPacketCode}`,
        thread_ts: messageTs,
      })
      return
    }

    // 如果正则表达式没有匹配到，使用 AI 进行深度分析
    const aiResult = await analyzeWithAI(contextMessages)
    if (aiResult.startsWith('红包码：')) {
      const redPacketCode = aiResult.replace('红包码：', '').trim()
      await say({
        text: `${redPacketCode}`,
        thread_ts: messageTs,
      })
    }
  } catch (error) {
    console.error('Error processing message:', error)
  }
})

// 启动应用
;(async () => {
  await app.start()
  console.log('⚡️ Slack bot is running!')
})()
