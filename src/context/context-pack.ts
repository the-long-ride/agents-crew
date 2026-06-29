export interface ContextPackInput {
  task: {
    taskId: string;
    goal: string;
    workflow: string;
    acceptanceCriteria: string[];
    changedFiles: string[];
    participants: Array<{ id: string; agent: string; role: string }>;
    tests?: Array<{ command: string; status: string; summary: string }>;
  };
  turns: Array<{ participantId: string; kind: string; summary: string }>;
  instructions: string[];
}

export function buildContextPack(input: ContextPackInput): string {
  const { task, turns, instructions } = input;
  const lines: string[] = [];

  lines.push(`# Task`);
  lines.push(``);
  lines.push(`- **ID**: ${task.taskId}`);
  lines.push(`- **Goal**: ${task.goal}`);
  lines.push(``);

  lines.push(`## Workflow`);
  lines.push(``);
  lines.push(task.workflow);
  lines.push(``);

  lines.push(`## Participants`);
  lines.push(``);
  lines.push(`| id | agent | role |`);
  lines.push(`| --- | --- | --- |`);
  for (const p of task.participants) {
    lines.push(`| ${p.id} | ${p.agent} | ${p.role} |`);
  }
  lines.push(``);

  lines.push(`## Acceptance Criteria`);
  lines.push(``);
  for (const c of task.acceptanceCriteria) {
    lines.push(`- ${c}`);
  }
  lines.push(``);

  lines.push(`## Changed Files`);
  lines.push(``);
  for (const f of task.changedFiles) {
    lines.push(`- ${f}`);
  }
  lines.push(``);

  if (task.tests && task.tests.length > 0) {
    lines.push(`## Test Results`);
    lines.push(``);
    lines.push(`| command | status | summary |`);
    lines.push(`| --- | --- | --- |`);
    for (const t of task.tests) {
      lines.push(`| ${t.command} | ${t.status} | ${t.summary} |`);
    }
    lines.push(``);
  }

  if (turns.length > 0) {
    lines.push(`## Previous Turns`);
    lines.push(``);
    turns.forEach((t, i) => {
      lines.push(`${i + 1}. **${t.participantId}** (${t.kind}): ${t.summary}`);
    });
    lines.push(``);
  }

  if (instructions.length > 0) {
    lines.push(`## Instructions`);
    lines.push(``);
    instructions.forEach((instr, i) => {
      lines.push(`${i + 1}. ${instr}`);
    });
    lines.push(``);
  }

  return lines.join('\n');
}
