import { useEffect, useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { BodyText, Button, Card } from '../../src/components/Controls';
import { Screen } from '../../src/components/Screen';
import { apiFetch } from '../../src/lib/api';

export default function SeriesDetail() {
  const { seriesId } = useLocalSearchParams<{ seriesId: string }>();
  const [series, setSeries] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { if (seriesId) apiFetch<Record<string, unknown>>(`/series/${seriesId}`).then(setSeries); }, [seriesId]);
  return (
    <Screen title="Series Detail">
      <Card>
        <BodyText>{String(series?.name ?? 'Loading...')}</BodyText>
        <Button onPress={() => router.push(`/chat/series/${seriesId}`)}>Ask About Series</Button>
        <Button onPress={() => router.push({ pathname: '/progress', params: { seriesId } })}>Update Series Progress</Button>
      </Card>
    </Screen>
  );
}
