import { GarconsSection } from '../garcons-section';
import { MesasSection } from '../mesas-section';

export default function MesasPage() {
  return (
    <div className="space-y-12">
      <section>
        <h1 className="text-2xl font-bold text-white tracking-tight mb-6">Mesas (QR)</h1>
        <MesasSection />
      </section>
      <section>
        <h2 className="text-2xl font-bold text-white tracking-tight mb-6">Garçons</h2>
        <GarconsSection />
      </section>
    </div>
  );
}
