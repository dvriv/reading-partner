import { useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { BodyText, Button, Card, Input } from '../src/components/Controls';
import { Screen } from '../src/components/Screen';
import { apiFetch } from '../src/lib/api';

export default function ReadingProgress() {
  const { bookId, seriesId } = useLocalSearchParams<{ bookId?: string; seriesId?: string }>();
  const [chapter, setChapter] = useState('1');
  const [bookNumber, setBookNumber] = useState('');
  const [offset, setOffset] = useState('');
  const [message, setMessage] = useState('');
  return (
    <Screen title="Reading Progress">
      <Card>
        <BodyText>Manual progress is available to all users. Offset-level progress may come from paid audio alignment.</BodyText>
        <Input placeholder="Current book number" value={bookNumber} onChangeText={setBookNumber} keyboardType="numeric" />
        <Input placeholder="Current chapter" value={chapter} onChangeText={setChapter} keyboardType="numeric" />
        <Input placeholder="Optional text offset" value={offset} onChangeText={setOffset} keyboardType="numeric" />
        <Button onPress={async () => {
          await apiFetch('/progress', { method: 'PATCH', body: JSON.stringify({ bookId, seriesId, currentBookNumber: bookNumber ? Number(bookNumber) : undefined, currentChapter: Number(chapter), currentTextOffset: offset ? Number(offset) : undefined, progressSource: 'manual' }) });
          setMessage('Progress saved.');
        }}>Save Progress</Button>
        <Button onPress={() => router.back()}>Back</Button>
        {message ? <BodyText>{message}</BodyText> : null}
      </Card>
    </Screen>
  );
}
