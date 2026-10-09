export class RelayError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = 'RelayError';
    this.code = code;
  }
}
