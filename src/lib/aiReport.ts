import { prisma } from './db';
import { formatPeriodTitle, type ReportPeriodType, toDateStr } from './reportPeriods';

type DiaryForReport = {
  date: Date;
  content: string;
};

const AI_REQUEST_TIMEOUT_MS = 45_000;

function getAIConfig() {
  const env = import.meta.env ? import.meta.env : process.env;
  const apiKey = env.AI_API_KEY;
  const baseUrl = (env.AI_BASE_URL || '').replace(/\/+$/, '');
  const modelName = env.AI_MODEL_NAME;

  if (!apiKey || !baseUrl || !modelName) {
    throw new Error('AI 配置不完整，请在 .env 中配置 AI_API_KEY、AI_BASE_URL、AI_MODEL_NAME');
  }

  return { apiKey, baseUrl, modelName };
}

function buildPrompt(type: ReportPeriodType, title: string, diaries: DiaryForReport[]) {
  const reportName = type === 'WEEK' ? '周报' : '月报';
  const diaryText = diaries
    .map((diary) => `【${toDateStr(diary.date)}】\n${diary.content}`)
    .join('\n\n---\n\n');

  return `请根据以下日记生成一份${reportName}。要求：
1. 语言温和、真诚，不要夸张说教。
2. 结构包含：概览、重要事件、情绪与能量、值得保留的观察、下阶段提醒。
3. 尽量引用具体日期，但不要编造日记里没有的事情。
4. 用 Markdown 输出，标题为“${title}”。

日记内容：
${diaryText}`;
}

async function callAI(prompt: string) {
  const { apiKey, baseUrl, modelName } = getAIConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: '你是一位细腻、克制、善于总结长期记录的中文日记整理助手。' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`AI 请求超时（${Math.round(AI_REQUEST_TIMEOUT_MS / 1000)}s）`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`AI 请求失败：${response.status} ${detail.slice(0, 240)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 返回内容为空');
  return { content: String(content), modelName };
}

export async function generateDiaryReport(reportId: string) {
  const report = await prisma.diaryReport.findUnique({ where: { id: reportId } });
  if (!report) return;

  await prisma.diaryReport.update({
    where: { id: reportId },
    data: { status: 'GENERATING', error: null },
  });

  try {
    const diaries = await prisma.diary.findMany({
      where: {
        userId: report.userId,
        date: { gte: report.periodStart, lte: report.periodEnd },
      },
      orderBy: { date: 'asc' },
      select: { date: true, content: true },
    });

    if (diaries.length === 0) {
      throw new Error('这个周期内还没有日记，暂时无法生成报告');
    }

    const title = formatPeriodTitle(report.type as ReportPeriodType, report.periodStart, report.periodEnd);
    const { content, modelName } = await callAI(buildPrompt(report.type as ReportPeriodType, title, diaries));

    await prisma.diaryReport.update({
      where: { id: reportId },
      data: { status: 'READY', title, content, modelName, error: null },
    });
  } catch (error) {
    await prisma.diaryReport.update({
      where: { id: reportId },
      data: {
        status: 'ERROR',
        error: error instanceof Error ? error.message : '生成失败',
      },
    });
  }
}
