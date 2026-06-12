import MeshMap from "@/components/MeshMap";

export const metadata = { title: "MESH map — STEP Explorer" };

export default function MeshPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">MESH map</h1>
      <MeshMap />
      <section className="text-sm text-neutral-400">
        <h2 className="mb-1 font-medium text-neutral-300">State colours</h2>
        <ul className="grid grid-cols-2 gap-1 md:grid-cols-3">
          <li><span className="mr-2 inline-block h-3 w-3 rounded-sm bg-neutral-50 align-middle" />Untouched</li>
          <li><span className="mr-2 inline-block h-3 w-3 rounded-sm bg-neutral-400 align-middle" />Partially mined</li>
          <li><span className="mr-2 inline-block h-3 w-3 rounded-sm bg-neutral-900 ring-1 ring-neutral-700 align-middle" />Trinity desert</li>
          <li><span className="mr-2 inline-block h-3 w-3 rounded-sm bg-blue-600 align-middle" />Trinity oasis</li>
          <li><span className="mr-2 inline-block h-3 w-3 rounded-sm bg-red-600 align-middle" />Restricted / frozen</li>
        </ul>
      </section>
    </div>
  );
}
