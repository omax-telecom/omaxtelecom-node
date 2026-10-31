/* Helpers that read request and response types from the generated OpenAPI operations. */

type SuccessCode = 200 | 201 | 202;

/** JSON request body of an operation. */
export type BodyOf<O> = O extends { requestBody?: { content: { "application/json": infer B } } } ? B : never;

/** Query parameters of an operation. */
export type QueryOf<O> = O extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;

/** JSON body of the successful response. */
export type OkJson<O> = O extends { responses: infer R }
  ? {
      [K in keyof R]: K extends SuccessCode
        ? R[K] extends { content: { "application/json": infer J } }
          ? J
          : never
        : never;
    }[keyof R]
  : never;

/** `data` of the successful response envelope. */
export type DataOf<O> = OkJson<O> extends { data: infer D } ? D : OkJson<O>;

/** One item of a list response (`data: T[]` or `data: { items: T[] }`). */
export type ItemOf<O> = DataOf<O> extends (infer I)[] ? I : DataOf<O> extends { items: (infer I)[] } ? I : never;
