
const express = require('express');
const cors = require("cors");
const app = express();
const port = 8000;
require("dotenv").config();

app.use(cors({
  origin: [
    'https://recipe-hub-client-psi.vercel.app',
    'http://localhost:3000'
  ],
  credentials: true
}));
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.get('/', (req, res) => {
  res.send('Hello World!');
});

const logger = (req,res,next) => {
  console.log("Logger middleware logged",req.params);
  next();
}

const verifyToken = (req,res,next) => {
  console.log("headers",req.headers)

  const authHeader = req.headers?.authorization
  if(!authHeader){
    return res.status(401).send({message: "Unauthorized access"})
  }

  const token = authHeader.split(" ")[1]
  if(!token){
        return res.status(401).send({message: "Unauthorized access"})
  }

  next();
}



// Keys must match what gets stored in user.plan after payment
const PLAN_LIMITS = {
  free:           2,
  seller_starter: 10,
  seller_pro:     50,
  seller_master:  Infinity,
};

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// async function run() {
//   try {
//     await client.connect();

client.connect(() => {
  console.log("connecting to mongoDB")
}).catch(console.dir)

    const database          = client.db("recipe");
    const recipeCollection  = database.collection("recipes");
    const userCollection    = database.collection("user");
    const subscriptionCollection = database.collection("subscriptions");
    const favoriteCollection = database.collection("favorites");
    const likesCollection = database.collection("likes");
    const purchaseCollection = database.collection("purchases");
    const reportCollection = database.collection("reports");


    // GET all recipes (with optional filters)
app.get("/api/recipes", async (req, res) => {
  try {
    const query = {};
    if (req.query.companyId) query.companyId = req.query.companyId;
    if (req.query.status)    query.status    = req.query.status;
    if (req.query.authorId)  query.authorId  = req.query.authorId;

    if (req.query.search) {
      query.recipeName = { $regex: req.query.search, $options: "i" };
    }

    if (req.query.category && req.query.category !== "All") {
      query.category = req.query.category;
    }

    const { page = 1, limit = 12 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const totalRecipes = await recipeCollection.countDocuments(query);
    const cursor = recipeCollection.find(query).skip(skip).limit(Number(limit));
    const result = await cursor.toArray();

    res.send({
      recipes: result,
      totalPages: Math.ceil(totalRecipes / Number(limit)),
      currentPage: Number(page),
    });
  } catch (err) {
    console.error("GET /api/recipes failed:", err);
    res.status(500).json({ error: err.message });
  }
});

    //start 
// GET - aggregated stats for a seller (favorites + engagement across all their recipes)
app.get("/api/recipes/stats/:authorId", async (req, res) => {
  try {
    const { authorId } = req.params;

    // Pull all of this seller's recipes (not just active) to sum likes
    const recipes = await recipeCollection
      .find({ authorId })
      .project({ _id: 1, likesCount: 1 })
      .toArray();

    const recipeIds = recipes.map((r) => r._id.toString());
    const totalLikes = recipes.reduce((sum, r) => sum + (r.likesCount || 0), 0);

    const totalFavorites = recipeIds.length
      ? await favoriteCollection.countDocuments({ recipeId: { $in: recipeIds } })
      : 0;

    const totalEngagement = totalLikes + totalFavorites;

    res.send({
      success: true,
      totalRecipes: recipes.length,
      totalLikes,
      totalFavorites,
      totalEngagement,
    });
  } catch (error) {
    console.error("Error fetching seller stats:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});
    //end

    //get the users
    // GET all users
app.get("/api/users", async (req, res) => {
  try {
    const users = await userCollection.find({}).toArray();

    res.send(users);
  } catch (err) {
    console.error(err);

    res.status(500).send({
      success: false,
      message: err.message,
    });
  }
});

//start
app.get("/api/admin/transactions", async (req, res) => {
  try {
    const [purchases, subscriptions] = await Promise.all([
      purchaseCollection.find({}).toArray(),
      subscriptionCollection.find({}).toArray(),
    ]);

    const purchaseTx = purchases.map((p) => ({
      id: p._id.toString(),
      user: p.userEmail || "ruhan@gmail.com",
      type: "Recipe",
      amount: p.price ?? 0,
      status: "paid",
      transactionId: p.stripeSessionId || p._id.toString(),
      date: p.purchasedAt || p._id.getTimestamp(),
    }));

    const subscriptionTx = subscriptions.map((s) => ({
      id: s._id.toString(),
      user: s.email || "—",
      type: "Premium",
      amount: s.price ?? 0,
      status: s.status || "paid",
      transactionId: s.stripeSessionId || s._id.toString(),
      date: s.createdAt || s._id.getTimestamp(),
    }));

    const combined = [...purchaseTx, ...subscriptionTx].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );

    res.send({ success: true, transactions: combined });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});
//end

// POST - confirm a Stripe payment and record purchase history (idempotent)
app.post("/api/purchases", async (req, res) => {
  try {
    const { sessionId, recipeId, userId, userEmail, price, title } = req.body;

    if (!sessionId || !recipeId) {
      return res.status(400).send({
        success: false,
        message: "Missing sessionId or recipeId",
      });
    }

    // Prevent duplicate inserts if the success page is revisited/refreshed
    const existing = await purchaseCollection.findOne({ stripeSessionId: sessionId });
    if (existing) {
      return res.send({ success: true, alreadyRecorded: true, purchase: existing });
    }

    let recipe = null;
    if (ObjectId.isValid(recipeId)) {
      recipe = await recipeCollection.findOne({ _id: new ObjectId(recipeId) });
    }

    const purchase = {
      stripeSessionId: sessionId,
      recipeId,
      userId: userId || null,
      userEmail: userEmail || null,

      recipeName: recipe?.recipeName || title || null,
      recipeImage: recipe?.image || null,
      authorName: recipe?.authorName || null,
      price: Number(price) || recipe?.price || 0,

      purchasedAt: new Date(),
    };

    const result = await purchaseCollection.insertOne(purchase);

    res.send({ success: true, insertedId: result.insertedId, purchase });
  } catch (error) {
    console.error("Error confirming purchase:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

app.get("/api/users/:userId/purchases", async (req, res) => {

  try {

    const { userId } = req.params;

    const purchases = await purchaseCollection
      .find({ userId })
      .sort({ purchasedAt: -1 })
      .toArray();

    res.send({
      success: true,
      purchases
    });

  } catch (err) {

    res.status(500).send({
      success: false
    });

  }

});
//end here

//block/unblock users

app.patch("/api/users/:id/toggle-block", async (req, res) => {
  try {
    const userId = req.params.id;
    const { isBlocked } = req.body; // Expecting boolean from client

    if (!ObjectId.isValid(userId)) {
      return res.status(400).send({ success: false, message: "Invalid User ID format" });
    }

    const result = await database.collection("user").updateOne(
      { _id: new ObjectId(userId) },
      { 
        $set: { 
          isBlocked: isBlocked,
          updatedAt: new Date()
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ success: false, message: "User not found" });
    }

    res.send({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Error toggling block state:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

// Feature status
// PATCH - Toggle recipe feature status
    app.patch("/api/recipes/:id/feature", async (req, res) => {
      try {
        const id = req.params.id;
        const { isFeatured } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
        }

        const result = await recipeCollection.updateOne(
          { _id: new ObjectId(id) },
          { 
            $set: { 
              isFeatured: isFeatured,
              updatedAt: new Date()
            } 
          }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("Error toggling feature state:", error);
        res.status(500).send({ success: false, message: "Internal Server Error" });
      }
    });
    // PATCH - Update a recipe (edit)
app.patch("/api/recipes/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
    }

    const updateData = { ...req.body, updatedAt: new Date() };
    delete updateData._id; // never let client overwrite _id

    const result = await recipeCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ success: false, message: "Recipe not found" });
    }

    res.send({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Error updating recipe:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

    // DELETE - Delete a recipe permanently
    app.delete("/api/recipes/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
        }

        const result = await recipeCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).send({ success: false, message: "Recipe not found" });
        }

        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (error) {
        console.error("Error deleting recipe:", error);
        res.status(500).send({ success: false, message: "Internal Server Error" });
      }
    });


    // 1. PATCH - Like/Unlike Recipe (now tracks per-user state)
app.patch("/api/recipes/:id/like", async (req, res) => {
  try {
    const recipeId = req.params.id;
    const { userId, isLiked } = req.body;

    if (!ObjectId.isValid(recipeId)) {
      return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
    }

    if (isLiked) {
      // Add like record (avoid duplicates)
      await likesCollection.updateOne(
        { userId, recipeId },
        { $setOnInsert: { userId, recipeId, createdAt: new Date() } },
        { upsert: true }
      );
    } else {
      await likesCollection.deleteOne({ userId, recipeId });
    }

    const result = await recipeCollection.updateOne(
      { _id: new ObjectId(recipeId) },
      { $inc: { likesCount: isLiked ? 1 : -1 } }
    );

    res.send({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Error updating likes:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

//start here
app.patch("/api/recipes/:id/favorite", async (req, res) => {
  try {
    const recipeId = req.params.id;
    const { userId, isSaved } = req.body;

    if (!ObjectId.isValid(recipeId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid Recipe ID",
      });
    }

    if (isSaved) {
      await favoriteCollection.updateOne(
        { userId, recipeId },
        {
          $setOnInsert: {
            userId,
            recipeId,
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );
    } else {
      await favoriteCollection.deleteOne({
        userId,
        recipeId,
      });
    }

    res.send({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).send({
      success: false,
      message: "Internal Server Error",
    });
  }
});
//end here

// GET - check like/favorite status for a user on a recipe (for initial page load)
app.get("/api/recipes/:id/status", async (req, res) => {
  try {
    const recipeId = req.params.id;
    const { userId } = req.query;

    const [liked, favorited] = await Promise.all([
      likesCollection.findOne({ userId, recipeId }),
      favoriteCollection.findOne({ userId, recipeId }),
    ]);

    res.send({ isLiked: !!liked, isSaved: !!favorited });
  } catch (error) {
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

// GET - user's liked recipes (for dashboard)
app.get("/api/users/:userId/liked-recipes", async (req, res) => {
  try {
    const { userId } = req.params;
    const likes = await likesCollection.find({ userId }).toArray();
    const recipeIds = likes.map(l => new ObjectId(l.recipeId));
    const recipes = await recipeCollection.find({ _id: { $in: recipeIds } }).toArray();
    res.send({ success: true, recipes });
  } catch (error) {
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

// GET - user's favorite recipes (for dashboard)
app.get("/api/users/:userId/favorites", async (req, res) => {
  try {
    const { userId } = req.params;
    const favs = await favoriteCollection.find({ userId }).toArray();
    const recipeIds = favs.map(f => new ObjectId(f.recipeId));
    const recipes = await recipeCollection.find({ _id: { $in: recipeIds } }).toArray();
    res.send({ success: true, recipes });
  } catch (error) {
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});


app.get("/api/users/:userId/favorites", async (req, res) => {
    try {
        const { userId } = req.params;

        // 1. Find all favorite records for this user
        const favoriteRecords = await favoriteCollection
            .find({ userId })
            .sort({ createdAt: -1 })
            .toArray();

        if (favoriteRecords.length === 0) {
            return res.send({ success: true, recipes: [] });
        }

        // 2. Collect the recipe ObjectIds
        const recipeObjectIds = favoriteRecords
            .map(f => {
                try { return new ObjectId(f.recipeId); }
                catch { return null; }
            })
            .filter(Boolean);

        // 3. Fetch the full recipe documents in one query
        const recipes = await recipeCollection
            .find({ _id: { $in: recipeObjectIds } })
            .toArray();

        // 4. Preserve the "most-recently-saved first" ordering
        const recipeMap = Object.fromEntries(recipes.map(r => [r._id.toString(), r]));
        const orderedRecipes = favoriteRecords
            .map(f => recipeMap[f.recipeId])
            .filter(Boolean);

        res.send({ success: true, recipes: orderedRecipes });
    } catch (error) {
        console.error("Error fetching favorites:", error);
        res.status(500).send({ success: false, message: "Internal Server Error" });
    }
});

//start
// GET - admin: platform-wide overview stats
app.get("/api/admin/stats", async (req, res) => {
  try {
    const [totalUsers, totalRecipes, premiumMembers, pendingReports] = await Promise.all([
      userCollection.countDocuments({}),
      recipeCollection.countDocuments({}),
      userCollection.countDocuments({
        plan: { $in: ["seller_starter", "seller_pro", "seller_master"] },
      }),
      reportCollection.countDocuments({ status: "pending" }),
    ]);

    res.send({
      success: true,
      totalUsers,
      totalRecipes,
      premiumMembers,
      pendingReports,
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});
//end


app.delete("/api/users/:userId/favorites/:recipeId", async (req, res) => {
    try {
        const { userId, recipeId } = req.params;
        const result = await favoriteCollection.deleteOne({ userId, recipeId });
        res.send({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
        console.error("Error deleting favorite:", error);
        res.status(500).send({ success: false, message: "Internal Server Error" });
    }
});
//end here
// GET - admin: reports, optionally filtered by status (pending | dismissed | removed | all)
app.get("/api/admin/reports", async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status && status !== "all") {
      query.status = status;
    }
    const reports = await reportCollection.find(query).sort({ createdAt: -1 }).toArray();
    res.send({ success: true, reports });
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

// POST - user submits a report on a recipe
app.post("/api/reports", async (req, res) => {
  try {
    const { recipeId, reportedBy, reason, description } = req.body;

    if (!recipeId || !reportedBy || !reason) {
      return res.status(400).send({
        success: false,
        message: "Missing recipeId, reportedBy, or reason",
      });
    }
    const [recipe, reporter] = await Promise.all([
      ObjectId.isValid(recipeId)
        ? recipeCollection.findOne({ _id: new ObjectId(recipeId) })
        : null,
      ObjectId.isValid(reportedBy)
        ? userCollection.findOne({ _id: new ObjectId(reportedBy) })
        : null,
    ]);

    const report = {
      recipeId,
      recipeName: recipe?.recipeName || null,
      reportedBy,
      reporterEmail: reporter?.email || null,
      reason,
      description: description || null,
      status: "pending",
      createdAt: new Date(),
    };

    const result = await reportCollection.insertOne(report);

    res.send({ success: true, insertedId: result.insertedId });
  } catch (error) {
    console.error("Error creating report:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});


// PATCH - admin: dismiss a single report (recipe stays untouched)
app.patch("/api/admin/reports/:id/dismiss", async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid Report ID" });
    }

    const result = await reportCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "dismissed", resolvedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ success: false, message: "Report not found" });
    }

    res.send({ success: true });
  } catch (error) {
    console.error("Error dismissing report:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

// PATCH - admin: remove the reported recipe + resolve every report tied to it
app.patch("/api/admin/reports/:id/remove-recipe", async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid Report ID" });
    }

    const report = await reportCollection.findOne({ _id: new ObjectId(id) });
    if (!report) {
      return res.status(404).send({ success: false, message: "Report not found" });
    }

    const { recipeId } = report;

    if (recipeId && ObjectId.isValid(recipeId)) {
      await recipeCollection.deleteOne({ _id: new ObjectId(recipeId) });
    }

    // Resolve this report AND any other pending reports pointing at the same recipe
    await reportCollection.updateMany(
      { recipeId },
      { $set: { status: "removed", resolvedAt: new Date() } }
    );

    res.send({ success: true });
  } catch (error) {
    console.error("Error removing reported recipe:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});
   
//end here
    // GET single recipe by ID
    app.get("/api/recipes/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await recipeCollection.findOne(query);
      res.send(result);
    });

    // GET recipe count by authorId
    // ⚠️ Must stay ABOVE /api/recipes/:id
    app.get("/api/recipes/count/:authorId", async (req, res) => {
      const { authorId } = req.params;
      const count = await recipeCollection.countDocuments({ authorId });
      res.send({ count });
    });

    app.post("/api/subscriptions", async (req, res) => {
  try {
    const data = req.body;

    // Prevent duplicate inserts if the success page is revisited/refreshed
    if (data.stripeSessionId) {
      const existing = await subscriptionCollection.findOne({
        stripeSessionId: data.stripeSessionId,
      });
      if (existing) {
        return res.send({ success: true, alreadyRecorded: true, subscription: existing });
      }
    }

    // 1. Save subscription record
    const subsInfo = {
      ...data,
      createdAt: new Date(),
    };
    const insertResult = await subscriptionCollection.insertOne(subsInfo);

    // 2. Update user.plan to e.g. "seller_starter" — matches PLAN_LIMITS keys
    const userFilter = { email: data.email };
    const userUpdate = {
      $set: {
        plan: data.planId,
        updatedAt: new Date(),
      },
    };
    const updateResult = await userCollection.updateOne(userFilter, userUpdate);

    res.send({
      success: true,
      insertedId: insertResult.insertedId,
      modified: updateResult.modifiedCount,
    });
  } catch (error) {
    console.error("Error creating subscription:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

    // POST create recipe — with plan limit enforcement
    app.post("/api/recipes", async (req, res) => {
      const { userPlan, ...recipeData } = req.body;
      const authorId = recipeData.authorId;

      // Reject anonymous users
      if (!authorId || authorId === "anonymous") {
        return res.status(401).send({
          success: false,
          message: "You must be logged in to create a recipe.",
        });
      }



      // ✅ Fetch the user's LIVE plan directly from DB — never trust the client
      const userDoc = await userCollection.findOne({ _id: new ObjectId(authorId) });
      const plan    = userDoc?.plan || "free";   // e.g. "seller_starter", "free"

      // ✅ Lookup limit — PLAN_LIMITS keys now match DB values exactly
      const limit = Object.prototype.hasOwnProperty.call(PLAN_LIMITS, plan)
        ? PLAN_LIMITS[plan]
        : PLAN_LIMITS["free"];

      // Count existing recipes for this user
      const existingCount = await recipeCollection.countDocuments({ authorId });

      console.log(`User: ${authorId} | Plan: ${plan} | Limit: ${limit} | Count: ${existingCount}`);

      if (existingCount >= limit) {
        return res.status(403).send({
          success: false,
          message: "LIMIT_REACHED",
          details: `Your ${plan} plan allows a maximum of ${limit === Infinity ? "unlimited" : limit} recipes. Please upgrade.`,
        });
      }

      // Insert recipe
      const result = await recipeCollection.insertOne({
        ...recipeData,
        createdAt: new Date(),
      });

      res.send({ success: true, insertedId: result.insertedId });
    });

//     // await client.db("admin").command({ ping: 1 });
//     console.log("Pinged your deployment. You successfully connected to MongoDB!");

//   } finally {
//     // keep connection open
//   }
// }

// run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

module.exports = app;