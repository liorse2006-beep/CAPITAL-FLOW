import React from 'react'

export default function Toast({ message, show, onClose }) {
  if (!show) return null;
  return (
    <div className={"toast " + (show ? "show" : "")}>
      <span>{message}</span>
      <button onClick={onClose}>x</button>
    </div>
  );
}
