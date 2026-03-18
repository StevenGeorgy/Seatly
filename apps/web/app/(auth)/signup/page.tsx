"use client";

import { useState } from "react";
import Link from "next/link";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Placeholder — will connect to Supabase Auth in Phase 2
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-xl shadow-md">
      <h1 className="mb-lg text-2xl font-bold text-text">Create restaurant account</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-lg">
        <div>
          <label htmlFor="name" className="mb-xs block text-sm font-medium text-text">
            Restaurant name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Restaurant"
            className="w-full rounded-md border border-border px-md py-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label htmlFor="email" className="mb-xs block text-sm font-medium text-text">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@restaurant.com"
            className="w-full rounded-md border border-border px-md py-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-xs block text-sm font-medium text-text">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-md border border-border px-md py-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-lg py-sm font-medium text-white hover:bg-primary-hover"
        >
          Sign up
        </button>
      </form>
      <p className="mt-lg text-center text-sm text-text-muted">
        <Link href="/login" className="hover:text-primary">
          Already have an account? Sign in
        </Link>
      </p>
    </div>
  );
}
