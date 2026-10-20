export class NotFoundError extends Error {
  constructor(what = "resource") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** A dependency (e.g. the virus scanner) is down; the request is refused rather than done unsafely. */
export class UnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnavailableError";
  }
}
