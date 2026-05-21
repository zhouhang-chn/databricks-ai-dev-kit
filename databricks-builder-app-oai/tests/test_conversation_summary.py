"""Regression checks for conversation list serialization."""

from server.db.models import Conversation


def test_conversation_summary_uses_prefetched_message_count_without_messages():
  """List views should not need full message bodies to show counts."""
  conversation = Conversation(id='conv-1', project_id='project-1', title='Existing Chat')
  conversation.__dict__['_message_count'] = 7

  summary = conversation.to_dict_summary()

  assert summary['message_count'] == 7

