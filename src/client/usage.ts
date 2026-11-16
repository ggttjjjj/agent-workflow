const tokens = new Intl.NumberFormat('zh-CN');

const count = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

/**
 * Turn the provider's usage payload into a compact, human-readable summary.
 * Unknown or malformed payloads fall back to「未知」instead of leaking raw JSON
 * into the sidebar.
 */
export function formatUsage(usage: unknown): string {
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return '未知';
    const u = usage as Record<string, unknown>;
    const prompt = count(u.prompt_tokens);
    const completion = count(u.completion_tokens);
    const total = count(u.total_tokens) ?? (prompt !== undefined && completion !== undefined ? prompt + completion : undefined);
    const parts: string[] = [];
    if (prompt !== undefined) parts.push(`输入 ${tokens.format(prompt)}`);
    if (completion !== undefined) parts.push(`输出 ${tokens.format(completion)}`);
    if (total !== undefined) parts.push(`合计 ${tokens.format(total)}`);
    return parts.length ? `${parts.join(' · ')} tokens` : '未知'
}
