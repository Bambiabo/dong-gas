import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MIN_CONFIDENCE = 85;

export async function POST(req: Request) {
  try {
    const { image } = await req.json();

    if (!image) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a precise fuel-dispenser meter reader. Read only the cumulative volume/litres counter shown on the pump display. Ignore price, litres-per-sale, money, labels, and any other numbers. Return JSON only: {\"digits\":\"<exact digits>\",\"confidence\":<0-100>}. Do not guess. If any digit is obscured, blurry, cut off, ambiguous, or uncertain, use confidence below 85. Never invent missing digits.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Read the exact cumulative litres meter digits from this fuel dispenser photo. Return only JSON.",
            },
            {
              type: "image_url",
              image_url: {
                url: image,
              },
            },
          ],
        },
      ],
      max_tokens: 100,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0].message.content?.trim() || "";
    let parsed: { digits?: unknown; confidence?: unknown } = {};

    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "The meter photo could not be read clearly. Retake it in good light." },
        { status: 422 },
      );
    }

    const digits = String(parsed.digits ?? "").replace(/[^0-9]/g, "");
    const confidence = Number(parsed.confidence ?? 0);

    if (!digits || !Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) {
      return NextResponse.json(
        { error: "The meter reading is not clear enough. Retake the photo close up, in good light, with no glare." },
        { status: 422 },
      );
    }

    return NextResponse.json({ success: true, digits, confidence });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to process image";
    console.error("AI Vision OCR Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
