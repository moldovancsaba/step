import { OnboardingForms } from "@/components/OnboardingForms";

export default function Home() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold">Pay for verified visits, not impressions</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-600">
          Place Trinity at your front door and reward real people who physically show up —
          every visit is proof-verified before your budget is spent. Rejected claims never
          charge you. Unused budget follows your refund policy. You never need to touch
          crypto: your account is managed by the foundation during the pilot.
        </p>
      </section>
      <OnboardingForms />
    </div>
  );
}
