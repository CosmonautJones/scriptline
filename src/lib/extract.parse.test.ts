import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commentBody } from "./comments.server.ts";
import { parseEmbedHtml, parseLesson } from "./extract.server.ts";

describe("parseEmbedHtml", () => {
  it("reads the post payload out of the embed page", () => {
    const payload = {
      gql_data: {
        shortcode_media: {
          shortcode: "AbCdEfGhIj",
          edge_media_to_caption: { edges: [{ node: { text: "Hello #one" } }] },
        },
      },
    };
    const html = `<script>{"contextJSON":${JSON.stringify(JSON.stringify(payload))}}</script>`;
    const parsed = parseEmbedHtml(html);
    assert.equal(parsed?.gql_data?.shortcode_media?.shortcode, "AbCdEfGhIj");
    assert.equal(
      parsed?.gql_data?.shortcode_media?.edge_media_to_caption?.edges?.[0]?.node?.text,
      "Hello #one",
    );
  });

  it("ignores a page with no post", () => {
    assert.equal(parseEmbedHtml("<html>nothing</html>"), null);
  });
});

describe("parseLesson", () => {
  const grounded = {
    brief: "A person shows a dashboard and says the trades run through a broker API, not the picture.",
    claim: "The dashboard is a visualization, not the trading system.",
    learnings: [
      { point: "Trades run through a broker API.", from: "said" },
      { point: "The caption names options day trading.", from: "caption" },
    ],
    concepts: [{ name: "API path", meaning: "Orders go through the broker, not the drawing." }],
    practice: [{ action: "Check whether your broker allows API orders.", proves: "You separated access from a picture." }],
    check: "Where do the trades actually run?",
  };

  it("keeps a lesson tied to the caption, the audio, or the frame", () => {
    const lesson = parseLesson(grounded);
    assert.equal(lesson?.learnings.length, 2);
    assert.equal(lesson?.learnings[0]?.from, "said");
  });

  it("drops a lesson that cites comments we do not have", () => {
    const lesson = parseLesson({
      ...grounded,
      learnings: [
        { point: "Commenters say the money is fake.", from: "comments" },
        { point: "He says it is real money.", from: "said" },
      ],
    });
    assert.equal(lesson, null);
  });

  it("keeps a reply that adds a question", () => {
    const lesson = parseLesson({
      ...grounded,
      learnings: [
        { point: "Trades run through a broker API.", from: "said" },
        { point: "Someone asked whether both strategies lost.", from: "reply" },
      ],
    });
    assert.equal(lesson?.learnings[1]?.from, "reply");
  });
});

describe("commentBody", () => {
  it("strips the name, the time, and the like button", () => {
    assert.equal(
      commentBody("aust816 1d Did both strategies lose or just 1? Like Reply", "aust816"),
      "Did both strategies lose or just 1?",
    );
  });

  it("drops a reply that is only the chrome", () => {
    assert.equal(commentBody("mattgifs 5h", "mattgifs"), "");
  });
});
