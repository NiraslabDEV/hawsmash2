import { SettingsSection } from '../settings-section';
import { PaysuiteSection } from '../paysuite-section';
import { PromoSection } from '../promo-section';

export default function DefinicoesPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight mb-6">Definições</h1>
        <SettingsSection />
      </div>
      <div className="border-t border-white/[0.08] pt-8">
        <PaysuiteSection />
      </div>
      <div className="border-t border-white/[0.08] pt-8">
        <PromoSection />
      </div>
    </div>
  );
}
