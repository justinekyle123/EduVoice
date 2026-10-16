<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SMS — test sender</title>
</head>
<body>
    <h1>Send a test text</h1>
    <p>
        Goes through the SMS Gateway app running on your phone. The gateway
        username and password are read from <code>sms/.env</code>, so there is
        nothing to log in with here.
    </p>
    <form method="post" action="function/sms.php">
       <label>Message:</label>
       <input type="text" name="message"> <!--your messages -->
       <label>Phone number:</label>
       <input type="text" name="number" placeholder="0917 123 4567"> <!--phone number -->
       <button type="submit">Submit</button>
    </form>
</body>
</html>
