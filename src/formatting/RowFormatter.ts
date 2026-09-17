/**
 * Renders query rows for a conversation.
 *
 * Truncation protects the context window: `SELECT *` on a large table would
 * otherwise flood the transcript and can exceed the client's message limit
 * outright.
 *
 * Note this truncates *output*, not the query. MySQL still materialises every
 * row, which is what MAX_EXECUTION_TIME on the session is there to bound.
 */
export class RowFormatter {
  public static readonly DEFAULT_MAX_ROWS = 100;

  constructor(private readonly maxRows: number = RowFormatter.DEFAULT_MAX_ROWS) {}

  public format(rows: unknown[]): string {
    const truncated = rows.length > this.maxRows;
    const shown = truncated ? rows.slice(0, this.maxRows) : rows;
    const body = JSON.stringify(shown, null, 2);

    if (!truncated) {
      return body;
    }

    // The note states the true total and names the fix, so the reader knows
    // they are seeing a sample and how to narrow it.
    return `${body}\n\n--- Showing ${this.maxRows} of ${rows.length} rows. Add a LIMIT clause for smaller results. ---`;
  }
}
