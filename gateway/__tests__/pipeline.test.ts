import { describe, it, expect } from "vitest";
import { z } from "zod";
import { definePipeline } from "../src/lib/pipeline";

const fakeHandler = {} as any;
const baseSchema = z.object({ designDraftId: z.string().uuid() });

describe("definePipeline — structure", () => {
  it("empty definition returns empty structures", () => {
    const p = definePipeline({});
    expect(p.stages).toEqual([]);
    expect(p.allQueues).toEqual([]);
  });

  it("single stage returns correct names and queues", () => {
    const p = definePipeline({
      requirement: {
        input: "requirement.input",
        output: "requirement.output",
        handler: fakeHandler,
        messageIn: baseSchema,
        messageOut: baseSchema,
      },
    });
    expect(p.stages).toEqual(["requirement"]);
    expect(p.allQueues).toEqual(["requirement.input", "requirement.output"]);
  });
});

describe("definePipeline — validation", () => {
  it("rejects schema without designDraftId", () => {
    expect(() =>
      definePipeline({
        a: {
          input: "a.in",
          output: "a.out",
          handler: fakeHandler,
          messageIn: z.object({ foo: z.string() }),
          messageOut: baseSchema,
        },
      })
    ).toThrow("designDraftId");
  });

  it("rejects duplicate queue names", () => {
    expect(() =>
      definePipeline({
        a: { input: "q", output: "q", handler: fakeHandler, messageIn: baseSchema, messageOut: baseSchema },
        b: { input: "q2", output: "q2", handler: fakeHandler, messageIn: baseSchema, messageOut: baseSchema },
      })
    ).toThrow("Duplicate queue names");
  });

  it("rejects input sharing an output queue name", () => {
    expect(() =>
      definePipeline({
        a: { input: "shared", output: "a.out", handler: fakeHandler, messageIn: baseSchema, messageOut: baseSchema },
        b: { input: "shared", output: "b.out", handler: fakeHandler, messageIn: baseSchema, messageOut: baseSchema },
      })
    ).toThrow("Duplicate queue names");
  });
});

describe("definePipeline — downstream", () => {
  it("getDownstream returns stages after the given stage", () => {
    const p = definePipeline({
      requirement: { input: "r.in", output: "r.out", handler: fakeHandler, messageIn: baseSchema, messageOut: baseSchema },
      recommendation: { input: "rec.in", output: "rec.out", handler: fakeHandler, messageIn: baseSchema, messageOut: baseSchema },
      codegen: { input: "c.in", output: "c.out", handler: fakeHandler, messageIn: baseSchema, messageOut: baseSchema },
    });
    expect(p.getDownstream("requirement")).toEqual(["recommendation", "codegen"]);
    expect(p.getDownstream("recommendation")).toEqual(["codegen"]);
    expect(p.getDownstream("codegen")).toEqual([]);
  });
});

describe("definePipeline — handler management", () => {
  it("handlerFor returns the handler for an output queue", () => {
    const h1 = {} as any;
    const h2 = {} as any;
    const p = definePipeline({
      a: { input: "a.in", output: "a.out", handler: h1, messageIn: baseSchema, messageOut: baseSchema },
      b: { input: "b.in", output: "b.out", handler: h2, messageIn: baseSchema, messageOut: baseSchema },
    });
    expect(p.handlerFor("a.out")).toBe(h1);
    expect(p.handlerFor("b.out")).toBe(h2);
    expect(p.handlerFor("nonexistent")).toBeUndefined();
  });

  it("handlerEntries returns all output queue + handler pairs in stage order", () => {
    const h1 = {} as any;
    const h2 = {} as any;
    const p = definePipeline({
      first: { input: "f.in", output: "f.out", handler: h1, messageIn: baseSchema, messageOut: baseSchema },
      second: { input: "s.in", output: "s.out", handler: h2, messageIn: baseSchema, messageOut: baseSchema },
    });
    expect(p.handlerEntries()).toEqual([
      ["f.out", h1],
      ["s.out", h2],
    ]);
  });
});
