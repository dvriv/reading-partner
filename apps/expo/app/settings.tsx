import { BodyText, Card } from '../src/components/Controls';
import { Screen } from '../src/components/Screen';

export default function Settings() {
  return (
    <Screen title="Settings">
      <Card>
        <BodyText>Supabase Auth is active. AI provider keys are server-only and cannot be configured in the app.</BodyText>
      </Card>
    </Screen>
  );
}
