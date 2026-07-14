import { useEffect, useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { BodyText, Button, Card } from '../../src/components/Controls';
import { Screen } from '../../src/components/Screen';
import { apiFetch } from '../../src/lib/api';

export default function BookDetail() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const [book, setBook] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { if (bookId) apiFetch<Record<string, unknown>>(`/books/${bookId}`).then(setBook); }, [bookId]);
  return (
    <Screen title="Book Detail">
      <Card>
        <BodyText>{String(book?.title ?? 'Loading...')}</BodyText>
        <BodyText>Status: {String(book?.processing_status ?? '')}</BodyText>
        <Button onPress={() => router.push(`/chat/book/${bookId}`)}>Ask About This Book</Button>
        <Button onPress={() => router.push({ pathname: '/progress', params: { bookId } })}>Update Progress</Button>
        <Button onPress={() => router.push({ pathname: '/audiobooks/attach', params: { bookId } })}>Attach Audiobook</Button>
      </Card>
    </Screen>
  );
}
