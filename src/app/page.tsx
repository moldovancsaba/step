'use client';

import { useState, useEffect } from 'react';

export default function Home() {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/message')
      .then(res => res.json())
      .then(data => {
        setMessage(data.message);
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load message');
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>{error}</div>;
  
  return <div>{message}</div>;
}
