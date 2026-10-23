const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a page's id parameter can be a record id at all; anything else is a plain "not found". */
export const isUuid = (value: string) => UUID.test(value);
