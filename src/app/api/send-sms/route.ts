import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { message } = await req.json();
    const apiKey = process.env.S1drSWluclRWemhSZUNyek51YmM;
    const ownerPhone = process.env.OWNER_PHONE_NUMBER; // e.g., 233557442892
    const senderId = process.env.SMS_SENDER_ID || "DongGas";

    if (!apiKey || !ownerPhone) {
      return NextResponse.json(
        { skipped: true, reason: "SMS environment variables not set yet" },
        { status: 200 }
      );
    }

    // Example using Arkesel V2 SMS API (Ghana)
    const response = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: senderId,
        message,
        recipients: [OWNER_PHONE_NUMBER],
      }),
    });

    const data = await response.json();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to dispatch SMS" },
      { status: 500 }
    );
  }
}