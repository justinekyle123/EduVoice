<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SMS</title>
</head>
<body>
    <form method="post" action="function/sms.php">
       <input type="hidden" name="username" value="KWY3UH"/>   <!--username base on the the cloud app username -->
       <input type="hidden" name="password" value="fkrr_yzhibm6kz"/>  <!--password base on the the cloud app password -->
       <label>Message:</label>
       <input type="text" name="message"> <!--your messages -->
       <label>Phone number:</label>
       <input type="text" name="number"> <!--phone number -->
       <button type="submit">Submit</button>
    </form>
</body>
</html>