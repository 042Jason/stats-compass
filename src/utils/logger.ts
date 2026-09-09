const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export const log = {
  info: (msg: string, extra?: unknown) => {
    console.log(`[${ts()}] i  ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);
  },
  ok: (msg: string, extra?: unknown) => {
    console.log(`[${ts()}] OK ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);
  },
  warn: (msg: string, extra?: unknown) => {
    console.warn(`[${ts()}] !  ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);
  },
  err: (msg: string, error?: unknown) => {
    console.error(`[${ts()}] X  ${msg}${error ? ' ' + String(error) : ''}`);
  },
};
