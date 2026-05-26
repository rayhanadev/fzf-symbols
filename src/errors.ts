export class TrufflerError extends Error {
  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class SymbolFileReadError extends TrufflerError {
  constructor(
    public readonly file: string,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(`${file}: ${message}`, options);
  }
}

export class SymbolIndexWriteError extends TrufflerError {
  constructor(
    public readonly file: string,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(`${file}: ${message}`, options);
  }
}

export class SymbolParseError extends TrufflerError {
  constructor(
    public readonly file: string,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(`${file}: ${message}`, options);
  }
}

export class SymbolWalkError extends TrufflerError {
  constructor(
    public readonly file: string,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(`${file}: ${message}`, options);
  }
}

export class SymbolScanAbortedError extends TrufflerError {
  constructor() {
    super("Symbol scan aborted");
  }
}
