# Send 1000 messages to the queue
import boto3

# Get the service resource
sqs = boto3.resource('sqs')

# Get the queue
queue = sqs.get_queue_by_name(QueueName='SqsFargateStack-SqsFargateQueueADE0FB79-2YVKZ8VTZ96K')

# Message Loop
my_seq = 1
while my_seq <= 1000:
  #print(my_seq)
  my_message = 'This was message ' + str(my_seq) # Create a message
  response = queue.send_message(MessageBody=my_message) # Send the message
  print(response) # print the output
  my_seq = my_seq + 1 # Add to the loop sequence
