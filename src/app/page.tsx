'use client';

import { useState, useEffect } from 'react';

export default function Home() {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch the message from the API
    const fetchMessage = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/message');
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json();
        setMessage(data.message);
      } catch (err) {
        console.error('Failed to fetch message:', err);
        setError('Failed to load message from database. Please check your connection.');
      } finally {
        setLoading(false);
      }
    };

    fetchMessage();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-indigo-950 p-4">
      <main className="flex flex-col items-center justify-center text-center max-w-4xl">
        {loading ? (
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-gray-700 dark:text-gray-300">Loading message from MongoDB Atlas...</p>
          </div>
        ) : error ? (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md mb-6">
            <p>{error}</p>
            <p className="text-sm mt-2">Check your MongoDB Atlas connection in .env.local</p>
          </div>
        ) : (
          <>
            <h1 className="text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-600 mb-6">
              {message || 'Hello World'}
            </h1>
            <p className="text-xl text-gray-700 dark:text-gray-300 mb-8">
              Welcome to my Next.js project deployed on Vercel with MongoDB Atlas
            </p>
          </>
        )}
        
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-xl w-full max-w-md mt-6">
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white mb-4">
            Project Stack
          </h2>
          <ul className="space-y-2 text-left">
            <li className="flex items-center">
              <span className="w-3 h-3 bg-indigo-500 rounded-full mr-2"></span>
              <span className="text-gray-700 dark:text-gray-300">Next.js with TypeScript</span>
            </li>
            <li className="flex items-center">
              <span className="w-3 h-3 bg-green-500 rounded-full mr-2"></span>
              <span className="text-gray-700 dark:text-gray-300">Tailwind CSS for styling</span>
            </li>
            <li className="flex items-center">
              <span className="w-3 h-3 bg-yellow-500 rounded-full mr-2"></span>
              <span className="text-gray-700 dark:text-gray-300">MongoDB Atlas for database</span>
            </li>
            <li className="flex items-center">
              <span className="w-3 h-3 bg-blue-500 rounded-full mr-2"></span>
              <span className="text-gray-700 dark:text-gray-300">Vercel for deployment</span>
            </li>
          </ul>
        </div>
      </main>
      
      <footer className="mt-12 text-center text-gray-600 dark:text-gray-400">
        <p>&copy; {new Date().getFullYear()} - My Next.js Project</p>
      </footer>
    </div>
  );
}
