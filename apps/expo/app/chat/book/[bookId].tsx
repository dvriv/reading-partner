import { useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { BodyText, Button, Card, Input } from '../../../src/components/Controls';
import { Screen } from '../../../src/components/Screen';
import { ask } from '../../../src/lib/api';

export default function BookChat() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  return (
    <Screen title="Book Chat">
      <Card>
        <Input placeholder="Ask without spoilers..." value={question} onChangeText={setQuestion} />
        <Button onPress={async () => {
          const response = await ask({ contextType: 'book', contextId: bookId, question });
          setAnswer((response as { answer: string }).answer);
        }}>Ask</Button>
      </Card>
      {answer ? <Card><BodyText>{answer}</BodyText></Card> : null}
    </Screen>
  );
}
