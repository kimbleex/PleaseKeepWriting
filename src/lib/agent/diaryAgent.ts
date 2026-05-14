import { ChatOpenAI } from '@langchain/openai';
import { createAgent } from 'langchain';
import { AI_REQUEST_TIMEOUT_MS, getAIConfig } from '../aiConfig';
import { getShanghaiDateStr } from './date';
import { createDiaryAgentTools } from './tools';
import { DIARY_AGENT_NAME, DIARY_ASSISTANT_SKILL } from './skills/diaryAssistantSkill';

export function createDiaryAgent(userId: string) {
  const { apiKey, baseUrl, modelName } = getAIConfig();
  const today = getShanghaiDateStr();

  const model = new ChatOpenAI({
    apiKey,
    model: modelName,
    temperature: 0.35,
    timeout: AI_REQUEST_TIMEOUT_MS,
    maxRetries: 1,
    streamUsage: false,
    configuration: {
      baseURL: baseUrl,
    },
  });

  return createAgent({
    model,
    tools: createDiaryAgentTools(userId),
    systemPrompt: `${DIARY_ASSISTANT_SKILL}

当前日期是 ${today}，时区是 Asia/Shanghai。你的名字是 ${DIARY_AGENT_NAME}，如果需要自我介绍，只说“我是 ${DIARY_AGENT_NAME}”。

职责：
1. 当用户询问最近、过去、本周、本月、某天、某段时间做了什么、情绪如何、有什么变化时，必须先调用 query_my_diaries_by_date_range 查询当前登录用户自己的日记。
2. 当用户要求新建、写入、修改、更新今天的日记时，必须调用 upsert_my_today_diary；该工具只会覆盖今天的完整日记内容，不要把它用于其他日期或他人日记。
3. 当用户提到明确用户名并询问该用户某段时间在做什么、有什么变化、日记总结时，必须调用 query_user_diaries_by_username_and_date_range；如果工具返回用户不存在或无权限，直接把原因告诉用户。
4. 相对日期按当前日期 ${today} 计算；“最近一周”表示截至今天的最近 7 天，包含今天。
5. 只能基于工具返回的日记内容总结，不要编造日记里没有的信息。
6. 如果工具返回为空，直接说明这个日期范围内没有已同步日记。
7. 回答要温和、具体、简洁，尽量按日期或主题归纳。`,
    name: 'diary_agent',
  });
}
