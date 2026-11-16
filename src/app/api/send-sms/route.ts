import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    const apiKey = process.env.ARKESEL_API_KEY;
    const ownerPhone = process.env.OWNER_PHONE_NUMBER; // e.g. 233557442892
    const senderId = process.env.SMS_SENDER_ID || "DongGas";

    if (!apiKey || !ownerPhone) {
      return NextResponse.json(
        { skipped: true, reason: "SMS environment variables not set yet" },
        { status: 200 }
      );
    }

    // Arkesel V2 SMS API
    const response = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: senderId,
        message: message,
        recipients: [ownerPhone], // 
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to send SMS", details: data },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error("SMS Error:", error);
    return NextResponse.json(
      { error: error.message || "Something went wrong" },
      { status: 500 }
    );
  }
}