import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-indigo-50/80 via-white to-white px-4 py-16">
      <SignUp />
    </div>
  );
}