import { useEffect, useState } from 'react';
import { BodyText, Card } from '../src/components/Controls';
import { Screen } from '../src/components/Screen';
import { apiFetch } from '../src/lib/api';

export default function Usage() {
  const [usage, setUsage] = useState<unknown>(null);
  useEffect(() => { apiFetch('/usage').then(setUsage); }, []);
  return <Screen title="Usage & Quota"><Card><BodyText>{JSON.stringify(usage, null, 2)}</BodyText></Card></Screen>;
}
