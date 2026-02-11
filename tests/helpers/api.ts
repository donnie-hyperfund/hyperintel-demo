/**
 * Lightweight call builder for Next.js route handler tests.
 *
 * Instead of supertest (which needs an Express server), we import
 * the route handler directly and call it with a constructed NextRequest.
 *
 * Pattern adapted from TuneGO's defineCall — same ergonomics,
 * but for Next.js App Router handlers instead of NestJS.
 */

import { NextRequest, NextResponse } from "next/server";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type RouteHandler = (
	req: NextRequest,
	ctx: { params: Promise<Record<string, string>> },
) => Promise<NextResponse>;

type CallResult = {
	res: NextResponse;
	status: number;
	body: any;
	json: string;
};

/**
 * Call a Next.js route handler with params and optional body.
 *
 * Usage:
 *   const { status, body } = await callRoute(GET, "/api/artifacts", { projectId: "..." });
 *   expect(status).toBe(200);
 */
export async function callRoute(
	handler: RouteHandler,
	url: string,
	params: Record<string, string> = {},
	options?: { method?: Method; body?: unknown },
): Promise<CallResult> {
	const method = options?.method ?? "GET";
	const init: RequestInit = { method };

	if (options?.body) {
		init.body = JSON.stringify(options.body);
		init.headers = { "Content-Type": "application/json" };
	}

	const req = new NextRequest(new URL(url, "http://localhost:3000"), init);
	const res = await handler(req, { params: Promise.resolve(params) });

	let body: any;
	try {
		body = await res.json();
	} catch {
		body = null;
	}

	return {
		res,
		status: res.status,
		body,
		json: JSON.stringify(body),
	};
}
