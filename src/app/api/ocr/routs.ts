import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const { image } = await req.json();

    if (!image) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an automated fuel dispenser meter reader. Your job is to look at the photo of the fuel pump meter counter and extract ONLY the numerical digits representing the volume/liters reading. Do not include any letters, decimal symbols, or explanations—return strictly the raw digits numbers (e.g. 104520).",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Read the exact meter digits from this fuel dispenser counter:",
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
      max_tokens: 50,
    });

    const detectedText = response.choices[0].message.content?.trim() || "";
    // Clean to ensure only digits are returned
    const digits = detectedText.replace(/[^0-9]/g, "");

    return NextResponse.json({ success: true, digits });
  } catch (error: any) {
    console.error("AI Vision OCR Error:", error);
    return NextResponse.json({ error: error.message || "Failed to process image" }, { status: 500 });
  }
}