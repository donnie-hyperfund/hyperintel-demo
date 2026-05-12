type MaybeWrappedToolResult<T> =
    | T
    | {
          result?: T;
          results?: T;
      };

export function getToolResult<T = any>(output: MaybeWrappedToolResult<T>): T {
    if (output && typeof output === 'object') {
        if ('result' in output) {
            return output.result as T;
        }
        if ('results' in output) {
            return output.results as T;
        }
    }

    return output as T;
}
