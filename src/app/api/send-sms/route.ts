import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = body.message;

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ARKESEL_API_KEY;
    const ownerPhone = process.env.OWNER_PHONE_NUMBER;
    const senderId = process.env.SMS_SENDER_ID || "DongGas";

    if (!apiKey || !ownerPhone) {
      return NextResponse.json(
        {
          skipped: true,
          reason: "ARKESEL_API_KEY or OWNER_PHONE_NUMBER is missing",
        },
        { status: 200 }
      );
    }

    const response = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: senderId,
        message: message,
        recipients: [ownerPhone],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Arkesel Error:", data);
      return NextResponse.json(
        { error: "Failed to send SMS", details: data },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "SMS sent successfully",
      data,
    });
  } catch (error: any) {
    console.error("SMS Route Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}