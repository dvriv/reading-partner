import { useEffect, useState } from 'react';
import { Link, router } from 'expo-router';
import type { LibraryResponse } from '@reading-partner/shared';
import { BodyText, Button, Card } from '../src/components/Controls';
import { Screen } from '../src/components/Screen';
import { apiFetch } from '../src/lib/api';
import { supabase } from '../src/lib/supabase';

export default function Library() {
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    apiFetch<LibraryResponse>('/library').then(setLibrary).catch((err) => setError(err.message));
  }, []);
  return (
    <Screen title="Library">
      <Card>
        <Link href="/upload" asChild><Button>Upload EPUB</Button></Link>
        <Link href="/usage" asChild><Button>Usage & Quota</Button></Link>
        <Link href="/settings" asChild><Button>Settings</Button></Link>
        <Button onPress={async () => { await supabase?.auth.signOut(); router.replace('/'); }}>Sign Out</Button>
      </Card>
      {error ? <BodyText>{error}</BodyText> : null}
      {library?.standaloneBooks.map((book) => (
        <Card key={book.id}>
          <BodyText>{book.title}</BodyText>
          <BodyText>{book.processingStatus} · chapter {book.currentChapter}/{book.totalChapters}</BodyText>
          <Button onPress={() => router.push(`/book/${book.id}`)}>Open Book</Button>
          <Button onPress={() => router.push(`/chat/book/${book.id}`)}>Book Chat</Button>
        </Card>
      ))}
      {library?.series.map((series) => (
        <Card key={series.id}>
          <BodyText>{series.name}</BodyText>
          <BodyText>{series.books.length} books</BodyText>
          <Button onPress={() => router.push(`/series/${series.id}`)}>Open Series</Button>
          <Button onPress={() => router.push(`/chat/series/${series.id}`)}>Series Chat</Button>
        </Card>
      ))}
    </Screen>
  );
}
